//! APNG compositing and shared-palette encoding, independent of JavaScript.
use imagequant::{Attributes, Histogram, Image, RGBA};
use png::{
    BitDepth, BlendOp, ColorType, DecodeOptions, Decoder, DisposeOp, Encoder, FrameControl,
    Transformations,
};
use std::{borrow::Cow, io::Cursor};

const MAX_ANIMATION_FRAMES: u32 = 1000;
const MAX_ANIMATION_PIXELS: usize = 67_108_864;

pub(crate) struct Frame {
    pub pixels: Vec<RGBA>,
    pub delay_num: u16,
    pub delay_den: u16,
}

pub(crate) struct Animation {
    pub width: u32,
    pub height: u32,
    pub num_plays: u32,
    pub poster: Option<Vec<RGBA>>,
    pub frames: Vec<Frame>,
}

pub(crate) struct QuantizedAnimation {
    pub animation: Animation,
    pub png: Vec<u8>,
    pub palette: Vec<RGBA>,
    pub quality: f64,
}

fn dimensions(width: u32, height: u32, frames: u32, poster: bool) -> Result<usize, String> {
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .filter(|&n| n > 0 && n <= super::MAX_IMAGE_PIXELS)
        .ok_or("Image exceeds the maximum of 16777216 pixels")?;
    if frames == 0 || frames > MAX_ANIMATION_FRAMES {
        return Err("APNG must contain between 1 and 1000 animation frames".into());
    }
    pixels
        .checked_mul(frames as usize + usize::from(poster))
        .filter(|&n| n <= MAX_ANIMATION_PIXELS)
        .ok_or("APNG exceeds the maximum of 67108864 total canvas pixels")?;
    Ok(pixels)
}

// Reader::finish validates the trailing stream but doesn't compare acTL's frame
// count with the actual fcTL count. Never silently discard undeclared frames.
fn validate_chunks(data: &[u8], expected_frames: Option<u32>) -> Result<(), String> {
    let mut offset = 8usize;
    let mut frames = 0u32;
    let mut controls = 0;
    let mut sequence = 0u64;
    while let Some(header) = data.get(offset..offset.saturating_add(8)) {
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|n| n.checked_add(length))
            .filter(|&n| n <= data.len())
            .ok_or("Truncated APNG chunk")?;
        let kind = &header[4..8];
        if kind == b"acTL" {
            controls += 1;
        }
        if kind == b"fcTL" || kind == b"fdAT" {
            if length < 4 {
                return Err("Invalid APNG frame chunk".into());
            }
            let number = u32::from_be_bytes(data[offset + 8..offset + 12].try_into().unwrap());
            if u64::from(number) != sequence {
                return Err("Invalid APNG frame sequence".into());
            }
            sequence += 1;
            if kind == b"fcTL" {
                frames += 1;
            }
        }
        if kind == b"IEND" {
            if length != 0
                || end != data.len()
                || controls != u32::from(expected_frames.is_some())
                || frames != expected_frames.unwrap_or(0)
            {
                return Err("APNG frame count or trailing data does not match its header".into());
            }
            return Ok(());
        }
        offset = end;
    }
    Err("APNG is missing IEND".into())
}

fn over(target: &mut RGBA, source: RGBA) {
    let sa = u32::from(source.a);
    if sa == 0 {
        return;
    }
    let da = u32::from(target.a);
    let alpha = sa * 255 + da * (255 - sa);
    let blend = |src: u8, dst: u8| {
        ((u32::from(src) * sa * 255 + u32::from(dst) * da * (255 - sa) + alpha / 2) / alpha) as u8
    };
    *target = RGBA::new(
        blend(source.r, target.r),
        blend(source.g, target.g),
        blend(source.b, target.b),
        ((alpha + 127) / 255) as u8,
    );
}

fn frame_pixels<'a>(
    buf: &'a [u8],
    info: &png::OutputInfo,
    interlaced: bool,
    canvas_width: u32,
    canvas_height: u32,
) -> Result<Cow<'a, [RGBA]>, String> {
    if info.bit_depth != BitDepth::Eight {
        return Err("PNG was not normalized to eight-bit channels".into());
    }
    if info.width == 0
        || info.height == 0
        || info.width > canvas_width
        || info.height > canvas_height
    {
        return Err("APNG frame dimensions are outside the canvas".into());
    }
    // png 0.18 deinterlaces APNG subframes with the IHDR canvas stride.
    let stride = if interlaced {
        canvas_width as usize * info.color_type.samples()
    } else {
        info.line_size
    };
    if info.color_type == ColorType::Rgba && stride == info.line_size {
        let bytes = buf
            .get(..info.buffer_size())
            .ok_or("Invalid APNG frame buffer size")?;
        // RGBA8 is a byte-aligned Pod. Borrow packed normalized pixels rather
        // than retaining another full canvas alongside the decoder's buffer.
        return Ok(Cow::Borrowed(bytemuck::cast_slice(bytes)));
    }
    let mut pixels = Vec::with_capacity(info.width as usize * info.height as usize);
    for y in 0..info.height as usize {
        let row = buf
            .get(y * stride..y * stride + info.line_size)
            .ok_or("Invalid APNG frame row size")?;
        match info.color_type {
            ColorType::Rgba => pixels.extend(
                row.as_chunks::<4>()
                    .0
                    .iter()
                    .map(|c| RGBA::new(c[0], c[1], c[2], c[3])),
            ),
            ColorType::Rgb => pixels.extend(
                row.as_chunks::<3>()
                    .0
                    .iter()
                    .map(|c| RGBA::new(c[0], c[1], c[2], 255)),
            ),
            ColorType::GrayscaleAlpha => pixels.extend(
                row.as_chunks::<2>()
                    .0
                    .iter()
                    .map(|c| RGBA::new(c[0], c[0], c[0], c[1])),
            ),
            ColorType::Grayscale => pixels.extend(row.iter().map(|&c| RGBA::new(c, c, c, 255))),
            _ => return Err("Unsupported PNG color type".into()),
        }
    }
    Ok(Cow::Owned(pixels))
}

fn composite(
    canvas: &mut [RGBA],
    source: &[RGBA],
    fc: FrameControl,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if fc.width == 0
        || fc.height == 0
        || fc.x_offset.checked_add(fc.width).is_none_or(|x| x > width)
        || fc
            .y_offset
            .checked_add(fc.height)
            .is_none_or(|y| y > height)
    {
        return Err("APNG frame rectangle is outside the canvas".into());
    }
    for y in 0..fc.height as usize {
        let start = (y + fc.y_offset as usize) * width as usize + fc.x_offset as usize;
        for (target, &pixel) in canvas[start..start + fc.width as usize]
            .iter_mut()
            .zip(&source[y * fc.width as usize..(y + 1) * fc.width as usize])
        {
            match fc.blend_op {
                BlendOp::Source => *target = pixel,
                BlendOp::Over => over(target, pixel),
            }
        }
    }
    Ok(())
}

pub(crate) fn decode(data: &[u8]) -> Result<Option<Animation>, String> {
    // Animation chunks are ancillary to a static PNG decoder, but dropping one
    // can change or corrupt playback. Treat their checksum failures as errors.
    let mut options = DecodeOptions::default();
    options.set_skip_ancillary_crc_failures(false);
    let mut decoder = Decoder::new_with_options(Cursor::new(data), options);
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("Failed to read PNG info: {e}"))?;
    let Some(control) = reader.info().animation_control else {
        // png deliberately ignores invalid acTL values. Such a file is not a
        // valid static PNG for these APIs: do not silently report "unanimated".
        validate_chunks(data, None)?;
        return Ok(None);
    };
    let width = reader.info().width;
    let height = reader.info().height;
    let separate_poster = reader.info().frame_control.is_none();
    let count = dimensions(width, height, control.num_frames, separate_poster)?;
    validate_chunks(data, Some(control.num_frames))?;
    let interlaced = reader.info().interlaced;
    let mut buffer = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("PNG output buffer size overflow")?
    ];
    let mut canvas = vec![RGBA::new(0, 0, 0, 0); count];
    let mut poster = None;
    let mut frames = Vec::with_capacity(control.num_frames as usize);
    for index in 0..control.num_frames as usize + usize::from(separate_poster) {
        let info = reader
            .next_frame(&mut buffer)
            .map_err(|e| format!("Failed to read APNG frame: {e}"))?;
        let pixels = frame_pixels(&buffer, &info, interlaced, width, height)?;
        if separate_poster && index == 0 {
            poster = Some(pixels.into_owned());
            continue;
        }
        let fc = reader
            .info()
            .frame_control
            .ok_or("Missing APNG frame control")?;
        if fc.width != info.width || fc.height != info.height {
            return Err("APNG frame dimensions do not match its control chunk".into());
        }
        if frames.is_empty()
            && !separate_poster
            && (fc.width != width || fc.height != height || fc.x_offset != 0 || fc.y_offset != 0)
        {
            return Err("APNG default animation frame must cover the canvas".into());
        }
        // The PNG decoder has checked the rectangle bounds. PREVIOUS only needs
        // to save that rectangle, even when the output frame is a full canvas.
        let previous = (fc.dispose_op == DisposeOp::Previous).then(|| {
            let mut saved = Vec::with_capacity(fc.width as usize * fc.height as usize);
            for y in 0..fc.height as usize {
                let start = (y + fc.y_offset as usize) * width as usize + fc.x_offset as usize;
                saved.extend_from_slice(&canvas[start..start + fc.width as usize]);
            }
            saved
        });
        composite(&mut canvas, &pixels, fc, width, height)?;
        frames.push(Frame {
            pixels: canvas.clone(),
            delay_num: fc.delay_num,
            delay_den: fc.delay_den,
        });
        match fc.dispose_op {
            DisposeOp::None => {}
            DisposeOp::Previous => {
                for (y, row) in previous
                    .unwrap()
                    .chunks_exact(fc.width as usize)
                    .enumerate()
                {
                    let start = (y + fc.y_offset as usize) * width as usize + fc.x_offset as usize;
                    canvas[start..start + fc.width as usize].copy_from_slice(row);
                }
            }
            DisposeOp::Background => {
                for y in 0..fc.height as usize {
                    let start = (y + fc.y_offset as usize) * width as usize + fc.x_offset as usize;
                    canvas[start..start + fc.width as usize].fill(RGBA::new(0, 0, 0, 0));
                }
            }
        }
    }
    reader
        .finish()
        .map_err(|e| format!("Failed to finish APNG: {e}"))?;
    Ok(Some(Animation {
        width,
        height,
        num_plays: control.num_plays,
        poster,
        frames,
    }))
}

pub(crate) fn quantize(
    mut animation: Animation,
    attr: &Attributes,
    dithering: Option<f64>,
) -> Result<QuantizedAnimation, String> {
    if dithering.is_some_and(|d| !d.is_finite() || !(0.0..=1.0).contains(&d)) {
        return Err("dithering must be between 0 and 1".into());
    }
    let width = animation.width as usize;
    let height = animation.height as usize;
    let mut histogram = Histogram::new(attr);
    for pixels in animation
        .poster
        .iter()
        .chain(animation.frames.iter().map(|f| &f.pixels))
    {
        let mut image = Image::new_borrowed(attr, pixels, width, height, 0.0)
            .map_err(|e| format!("Failed to create APNG image: {e}"))?;
        histogram
            .add_image(attr, &mut image)
            .map_err(|e| format!("Failed to collect APNG colors: {e}"))?;
    }
    // Histogram quantization freezes the palette: remapping later frames cannot
    // invalidate earlier indices or the one shared APNG PLTE chunk.
    let mut result = histogram
        .quantize(attr)
        .map_err(|e| format!("Failed to quantize APNG: {e}"))?;
    drop(histogram);
    let quality = f64::from(result.quantization_quality().unwrap_or(0)) / 100.0;
    if let Some(d) = dithering {
        result
            .set_dithering_level(d as f32)
            .map_err(|e| format!("Failed to set dithering: {e}"))?;
    }
    let palette = result.palette().to_vec();
    let mut png = Vec::new();
    {
        let mut encoder = Encoder::new(&mut png, animation.width, animation.height);
        encoder.set_color(ColorType::Indexed);
        encoder.set_depth(BitDepth::Eight);
        encoder.set_palette(
            palette
                .iter()
                .flat_map(|c| [c.r, c.g, c.b])
                .collect::<Vec<_>>(),
        );
        if let Some(last) = palette.iter().rposition(|c| c.a < 255) {
            encoder.set_trns(palette[..=last].iter().map(|c| c.a).collect::<Vec<_>>());
        }
        encoder
            .set_animated(animation.frames.len() as u32, animation.num_plays)
            .map_err(|e| e.to_string())?;
        encoder
            .set_sep_def_img(animation.poster.is_some())
            .map_err(|e| e.to_string())?;
        encoder
            .set_blend_op(BlendOp::Source)
            .map_err(|e| e.to_string())?;
        encoder
            .set_dispose_op(DisposeOp::None)
            .map_err(|e| e.to_string())?;
        encoder.validate_sequence(true);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        let mut remap = |pixels: &mut Vec<RGBA>| -> Result<Vec<u8>, String> {
            let indices = {
                let mut image = Image::new_borrowed(attr, pixels, width, height, 0.0)
                    .map_err(|e| e.to_string())?;
                result
                    .remapped(&mut image)
                    .map_err(|e| format!("Failed to remap APNG: {e}"))?
                    .1
            };
            for (pixel, &index) in pixels.iter_mut().zip(&indices) {
                *pixel = palette[index as usize];
            }
            Ok(indices)
        };
        if let Some(poster) = &mut animation.poster {
            writer
                .write_image_data(&remap(poster)?)
                .map_err(|e| e.to_string())?;
        }
        for frame in &mut animation.frames {
            writer
                .set_frame_delay(frame.delay_num, frame.delay_den)
                .map_err(|e| e.to_string())?;
            writer
                .write_image_data(&remap(&mut frame.pixels)?)
                .map_err(|e| e.to_string())?;
        }
        writer
            .finish()
            .map_err(|e| format!("Failed to finish APNG encoding: {e}"))?;
    }
    Ok(QuantizedAnimation {
        animation,
        png,
        palette,
        quality,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn over_handles_straight_alpha() {
        let mut opaque = RGBA::new(255, 0, 0, 255);
        over(&mut opaque, RGBA::new(0, 0, 255, 128));
        assert_eq!(opaque, RGBA::new(127, 0, 128, 255));
        let mut translucent = RGBA::new(255, 0, 0, 128);
        over(&mut translucent, RGBA::new(0, 0, 255, 128));
        assert_eq!(translucent, RGBA::new(85, 0, 170, 192));
        over(&mut translucent, RGBA::new(255, 255, 255, 0));
        assert_eq!(translucent, RGBA::new(85, 0, 170, 192));
        let mut empty = RGBA::new(0, 0, 0, 0);
        over(&mut empty, RGBA::new(9, 11, 13, 128));
        assert_eq!(empty, RGBA::new(9, 11, 13, 128));
    }

    #[test]
    fn animation_limits_include_poster_and_full_canvases() {
        assert!(dimensions(4096, 4096, 4, false).is_ok());
        assert!(dimensions(4096, 4096, 4, true).is_err());
        assert!(dimensions(4097, 4097, 1, false).is_err());
        assert!(dimensions(1, 1, 1001, false).is_err());
        assert!(dimensions(u32::MAX, u32::MAX, u32::MAX, true).is_err());
    }
}
