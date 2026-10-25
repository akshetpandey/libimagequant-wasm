//! APNG compositing and shared-palette encoding, independent of JavaScript.
use crate::metadata::{self, Policy};
use imagequant::{Attributes, Histogram, Image, RGBA};
use png::{BitDepth, BlendOp, ColorType, DisposeOp, Encoder, FrameControl};
use std::borrow::Cow;

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
pub(crate) fn validate_chunks(data: &[u8], expected_frames: Option<u32>) -> Result<(), String> {
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

pub(crate) fn frame_pixels<'a>(
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

#[derive(Clone, Copy)]
struct Header {
    width: u32,
    height: u32,
    num_plays: u32,
    num_frames: u32,
    separate_poster: bool,
    gamma: f64,
}

fn visit(
    data: &[u8],
    policy: Policy,
    mut frame: impl FnMut(Header, &[RGBA], Option<FrameControl>) -> Result<(), String>,
) -> Result<Option<(Header, png::Info<'static>)>, String> {
    // Animation chunks are ancillary to a static PNG decoder, but dropping one
    // can change or corrupt playback. Treat their checksum failures as errors.
    let decoder = metadata::decoder(data, policy);
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
    let header = Header {
        width,
        height,
        num_plays: control.num_plays,
        num_frames: control.num_frames,
        separate_poster,
        gamma: metadata::gamma(reader.info()),
    };
    let mut frame_index = 0;
    for index in 0..control.num_frames as usize + usize::from(separate_poster) {
        let info = reader
            .next_frame(&mut buffer)
            .map_err(|e| format!("Failed to read APNG frame: {e}"))?;
        let pixels = frame_pixels(&buffer, &info, interlaced, width, height)?;
        if separate_poster && index == 0 {
            frame(header, &pixels, None)?;
            continue;
        }
        let fc = reader
            .info()
            .frame_control
            .ok_or("Missing APNG frame control")?;
        if fc.width != info.width || fc.height != info.height {
            return Err("APNG frame dimensions do not match its control chunk".into());
        }
        if frame_index == 0
            && !separate_poster
            && (fc.width != width || fc.height != height || fc.x_offset != 0 || fc.y_offset != 0)
        {
            return Err("APNG default animation frame must cover the canvas".into());
        }
        // No later frame observes final disposal. Initially the canvas is
        // transparent, so PREVIOUS is equivalent to BACKGROUND as APNG requires.
        let disposal = if frame_index + 1 == control.num_frames as usize {
            DisposeOp::None
        } else if frame_index == 0 && fc.dispose_op == DisposeOp::Previous {
            DisposeOp::Background
        } else {
            fc.dispose_op
        };
        // The PNG decoder has checked the rectangle bounds. PREVIOUS only needs
        // to save that rectangle, even when the output frame is a full canvas.
        let previous = (disposal == DisposeOp::Previous).then(|| {
            let mut saved = Vec::with_capacity(fc.width as usize * fc.height as usize);
            for y in 0..fc.height as usize {
                let start = (y + fc.y_offset as usize) * width as usize + fc.x_offset as usize;
                saved.extend_from_slice(&canvas[start..start + fc.width as usize]);
            }
            saved
        });
        composite(&mut canvas, &pixels, fc, width, height)?;
        frame(header, &canvas, Some(fc))?;
        frame_index += 1;
        match disposal {
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
    Ok(Some((header, metadata::select(reader.info(), policy)?)))
}

pub(crate) fn decode(data: &[u8]) -> Result<Option<Animation>, String> {
    let mut frames = Vec::new();
    let mut poster = None;
    let header = visit(data, Policy::None, |_, pixels, control| {
        if let Some(fc) = control {
            frames.push(Frame {
                pixels: pixels.to_vec(),
                delay_num: fc.delay_num,
                delay_den: fc.delay_den,
            });
        } else {
            poster = Some(pixels.to_vec());
        }
        Ok(())
    })?;
    Ok(header.map(|(h, _)| Animation {
        width: h.width,
        height: h.height,
        num_plays: h.num_plays,
        poster,
        frames,
    }))
}

// Compare final palette indices so dithering and transparent pixels stay exact.
fn delta<'a>(
    indices: &'a [u8],
    previous: &[u8],
    width: u32,
    height: u32,
) -> (u32, u32, u32, u32, Cow<'a, [u8]>) {
    if previous.is_empty() {
        return (0, 0, width, height, Cow::Borrowed(indices));
    }
    let (mut x0, mut y0, mut x1, mut y1) = (width, height, 0, 0);
    for (i, (&new, &old)) in indices.iter().zip(previous).enumerate() {
        if new != old {
            let x = i as u32 % width;
            let y = i as u32 / width;
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x + 1);
            y1 = y1.max(y + 1);
        }
    }
    // APNG cannot encode empty frames. Preserve the delay with one replacement.
    if x1 == 0 {
        return (0, 0, 1, 1, Cow::Borrowed(&indices[..1]));
    }
    let w = x1 - x0;
    let h = y1 - y0;
    if w == width {
        return (
            x0,
            y0,
            w,
            h,
            Cow::Borrowed(&indices[y0 as usize * width as usize..y1 as usize * width as usize]),
        );
    }
    let mut cropped = Vec::with_capacity(w as usize * h as usize);
    for y in y0..y1 {
        let start = y as usize * width as usize + x0 as usize;
        cropped.extend_from_slice(&indices[start..start + w as usize]);
    }
    (x0, y0, w, h, Cow::Owned(cropped))
}

pub(crate) fn quantize(
    data: &[u8],
    attr: &Attributes,
    dithering: Option<f64>,
    include_frame_data: bool,
    policy: Policy,
) -> Result<Option<QuantizedAnimation>, String> {
    if dithering.is_some_and(|d| !d.is_finite() || !(0.0..=1.0).contains(&d)) {
        return Err("dithering must be between 0 and 1".into());
    }
    // Pass one retains the histogram, never the composited frame sequence.
    let mut histogram = Histogram::new(attr);
    let Some((header, info)) = visit(data, policy, |h, pixels, _| {
        let mut image =
            Image::new_borrowed(attr, pixels, h.width as usize, h.height as usize, h.gamma)
                .map_err(|e| format!("Failed to create APNG image: {e}"))?;
        histogram
            .add_image(attr, &mut image)
            .map_err(|e| format!("Failed to collect APNG colors: {e}"))
    })?
    else {
        return Ok(None);
    };
    // Histogram quantization freezes the shared palette before any encoding.
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
    let mut animation = Animation {
        width: header.width,
        height: header.height,
        num_plays: header.num_plays,
        poster: None,
        frames: Vec::with_capacity(header.num_frames as usize),
    };
    {
        let mut encoder = Encoder::with_info(&mut png, info).map_err(|e| e.to_string())?;
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
            .set_animated(header.num_frames, header.num_plays)
            .map_err(|e| e.to_string())?;
        encoder
            .set_sep_def_img(header.separate_poster)
            .map_err(|e| e.to_string())?;
        encoder
            .set_blend_op(BlendOp::Source)
            .map_err(|e| e.to_string())?;
        encoder
            .set_dispose_op(DisposeOp::None)
            .map_err(|e| e.to_string())?;
        encoder.validate_sequence(true);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        let mut previous_indices = Vec::new();
        // Pass two remaps and writes one frame at a time. Only requested pixels
        // and the default-image preview survive the callback.
        visit(data, Policy::None, |h, pixels, control| {
            let indices = {
                let mut image =
                    Image::new_borrowed(attr, pixels, h.width as usize, h.height as usize, h.gamma)
                        .map_err(|e| e.to_string())?;
                result
                    .remapped(&mut image)
                    .map_err(|e| format!("Failed to remap APNG: {e}"))?
                    .1
            };
            let retain = control.is_none()
                || include_frame_data
                || (!header.separate_poster && animation.frames.is_empty());
            let pixels = if retain {
                indices.iter().map(|&i| palette[i as usize]).collect()
            } else {
                Vec::new()
            };
            if let Some(fc) = control {
                writer
                    .set_frame_delay(fc.delay_num, fc.delay_den)
                    .map_err(|e| e.to_string())?;
                animation.frames.push(Frame {
                    pixels,
                    delay_num: fc.delay_num,
                    delay_den: fc.delay_den,
                });
            } else {
                animation.poster = Some(pixels);
            }
            if control.is_some() {
                let (x, y, w, height, region) =
                    delta(&indices, &previous_indices, h.width, h.height);
                // Reset the previous offset before growing the next rectangle.
                writer.reset_frame_position().map_err(|e| e.to_string())?;
                writer
                    .set_frame_dimension(w, height)
                    .map_err(|e| e.to_string())?;
                writer.set_frame_position(x, y).map_err(|e| e.to_string())?;
                writer
                    .write_image_data(&region)
                    .map_err(|e| e.to_string())?;
                previous_indices = indices;
                Ok(())
            } else {
                writer.write_image_data(&indices).map_err(|e| e.to_string())
            }
        })?;
        writer
            .finish()
            .map_err(|e| format!("Failed to finish APNG encoding: {e}"))?;
    }
    Ok(Some(QuantizedAnimation {
        animation,
        png,
        palette,
        quality,
    }))
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
