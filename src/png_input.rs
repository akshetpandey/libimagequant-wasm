//! Static PNG quantization using the same typed png-rs metadata policy as APNG.
use crate::{
    animation::frame_pixels,
    metadata::{self, Policy},
};
use imagequant::{Attributes, Image, RGBA};
use png::{BitDepth, ColorType, Encoder};

pub(crate) struct ResultImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<RGBA>,
    pub png: Vec<u8>,
    pub palette: Vec<RGBA>,
    pub quality: f64,
}

pub(crate) fn quantize(
    data: &[u8],
    attr: &Attributes,
    dithering: Option<f64>,
    policy: Policy,
) -> Result<ResultImage, String> {
    if dithering.is_some_and(|d| !d.is_finite() || !(0.0..=1.0).contains(&d)) {
        return Err("dithering must be between 0 and 1".into());
    }
    let mut reader = metadata::decoder(data, policy)
        .read_info()
        .map_err(|e| format!("Failed to read PNG info: {e}"))?;
    if reader.info().animation_control.is_some() {
        return Err("Use quantizePngAnimation for animated PNG".into());
    }
    crate::animation::validate_chunks(data, None)?;
    let (width, height) = reader.info().size();
    (width as usize)
        .checked_mul(height as usize)
        .filter(|&n| n > 0 && n <= crate::MAX_IMAGE_PIXELS)
        .ok_or("Image exceeds the maximum of 16777216 pixels")?;
    let gamma = metadata::gamma(reader.info());
    let mut buffer = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("PNG output buffer size overflow")?
    ];
    let output = reader
        .next_frame(&mut buffer)
        .map_err(|e| format!("Failed to read PNG frame: {e}"))?;
    let pixels = frame_pixels(&buffer, &output, reader.info().interlaced, width, height)?;
    let mut image = Image::new_borrowed(attr, &pixels, width as usize, height as usize, gamma)
        .map_err(|e| format!("Failed to create PNG image: {e}"))?;
    let mut result = attr
        .quantize(&mut image)
        .map_err(|e| format!("Failed to quantize PNG: {e}"))?;
    let quality = f64::from(result.quantization_quality().unwrap_or(0)) / 100.0;
    if let Some(d) = dithering {
        result
            .set_dithering_level(d as f32)
            .map_err(|e| e.to_string())?;
    }
    let (palette, indices) = result
        .remapped(&mut image)
        .map_err(|e| format!("Failed to remap PNG: {e}"))?;
    drop(image);
    drop(pixels);
    drop(buffer);
    reader
        .finish()
        .map_err(|e| format!("Failed to finish PNG: {e}"))?;
    let info = metadata::select(reader.info(), policy)?;
    let mut png = Vec::new();
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
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&indices)
            .map_err(|e| e.to_string())?;
        writer.finish().map_err(|e| e.to_string())?;
    }
    Ok(ResultImage {
        width,
        height,
        pixels: indices.iter().map(|&i| palette[i as usize]).collect(),
        png,
        palette,
        quality,
    })
}
