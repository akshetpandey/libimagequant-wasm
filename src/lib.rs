use wasm_bindgen::prelude::*;
use js_sys::{Array, Uint8Array, Uint8ClampedArray};
use imagequant::{Attributes, Image, RGBA};
use png::{Decoder, Encoder, ColorType, BitDepth, Transformations};
use std::io::Cursor;

fn checked_integer(value: f64, min: u32, max: u32, name: &str) -> Result<u32, JsValue> {
    if !value.is_finite() || value.fract() != 0.0 || value < min as f64 || value > max as f64 {
        return Err(JsValue::from_str(&format!("{} must be an integer between {} and {}", name, min, max)));
    }
    Ok(value as u32)
}

// Bound output allocations before reading PNG pixels or entering imagequant.
// Quantization needs several copies/work buffers in addition to the RGBA image.
const MAX_IMAGE_PIXELS: usize = 16_777_216;

fn checked_dimensions(width: f64, height: f64) -> Result<(usize, usize, usize), JsValue> {
    let w = checked_integer(width, 1, u32::MAX, "width")? as usize;
    let h = checked_integer(height, 1, u32::MAX, "height")? as usize;
    let pixels = w.checked_mul(h)
        .filter(|&count| count <= MAX_IMAGE_PIXELS)
        .ok_or_else(|| JsValue::from_str("Image exceeds the maximum of 16777216 pixels"))?;
    Ok((w, h, pixels))
}

// Initialize panic hook for better error messages in development
#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct ImageQuantizer {
    attr: Attributes,
}

#[wasm_bindgen]
impl ImageQuantizer {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            attr: Attributes::new(),
        }
    }

    #[wasm_bindgen(js_name = setSpeed)]
    pub fn set_speed(&mut self, speed: f64) -> Result<(), JsValue> {
        let speed = checked_integer(speed, 1, 10, "speed")?;
        self.attr.set_speed(speed as i32)
            .map_err(|e| JsValue::from_str(&format!("Failed to set speed: {:?}", e)))
    }

    #[wasm_bindgen(js_name = setQuality)]
    pub fn set_quality(&mut self, min: f64, target: f64) -> Result<(), JsValue> {
        let min = checked_integer(min, 0, 100, "minimum quality")?;
        let target = checked_integer(target, 0, 100, "target quality")?;
        self.attr.set_quality(min as u8, target as u8)
            .map_err(|e| JsValue::from_str(&format!("Failed to set quality: {:?}", e)))
    }

    #[wasm_bindgen(js_name = setMaxColors)]
    pub fn set_max_colors(&mut self, colors: f64) -> Result<(), JsValue> {
        let colors = checked_integer(colors, 2, 256, "maxColors")?;
        self.attr.set_max_colors(colors)
            .map_err(|e| JsValue::from_str(&format!("Failed to set max colors: {:?}", e)))
    }

    #[wasm_bindgen(js_name = setPosterization)]
    pub fn set_posterization(&mut self, posterization: f64) -> Result<(), JsValue> {
        let posterization = checked_integer(posterization, 0, 4, "posterization")?;
        self.attr.set_min_posterization(posterization as u8)
            .map_err(|e| JsValue::from_str(&format!("Failed to set posterization: {:?}", e)))
    }

    #[wasm_bindgen(js_name = quantizeImage)]
    pub fn quantize_image(&mut self, rgba_data: &Uint8ClampedArray, width: f64, height: f64) -> Result<QuantizationResult, JsValue> {
        let (w, h, pixels) = checked_dimensions(width, height)?;
        if rgba_data.length() as usize != pixels * 4 {
            return Err(JsValue::from_str("Image data length doesn't match width * height * 4"));
        }

        // Convert u8 data to RGBA array
        let rgba_pixels: Vec<RGBA> = rgba_data.to_vec()
            .chunks_exact(4)
            .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
            .collect();

        let mut img = Image::new(&mut self.attr, rgba_pixels.into_boxed_slice(), w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("Failed to create image: {:?}", e)))?;

        let result = self.attr.quantize(&mut img)
            .map_err(|e| JsValue::from_str(&format!("Failed to quantize image: {:?}", e)))?;

        Ok(QuantizationResult { result })
    }

}

#[wasm_bindgen]
#[derive(Clone)]
pub struct QuantizationResult {
    result: imagequant::QuantizationResult,
}

#[wasm_bindgen]
impl QuantizationResult {
    #[wasm_bindgen(js_name = getPalette)]
    pub fn get_palette(&mut self) -> Array {
        let palette = self.result.palette();
        let js_palette = Array::new();
        
        for color in palette {
            let rgba_array = Array::new();
            rgba_array.push(&JsValue::from(color.r));
            rgba_array.push(&JsValue::from(color.g));
            rgba_array.push(&JsValue::from(color.b));
            rgba_array.push(&JsValue::from(color.a));
            js_palette.push(&rgba_array);
        }
        
        js_palette
    }

    #[wasm_bindgen(js_name = getPaletteLength)]
    pub fn get_palette_length(&mut self) -> usize {
        self.result.palette().len()
    }

    #[wasm_bindgen(js_name = getQuantizationQuality)]
    pub fn get_quantization_quality(&self) -> f64 {
        self.result.quantization_quality().unwrap_or(0) as f64 / 100.0
    }

    #[wasm_bindgen(js_name = setDithering)]
    pub fn set_dithering(&mut self, dithering_level: f64) -> Result<(), JsValue> {
        if !dithering_level.is_finite() || !(0.0..=1.0).contains(&dithering_level) {
            return Err(JsValue::from_str("dithering must be between 0 and 1"));
        }
        self.result.set_dithering_level(dithering_level as f32)
            .map_err(|e| JsValue::from_str(&format!("Failed to set dithering: {:?}", e)))
    }

    #[wasm_bindgen(js_name = remapImage)]
    pub fn remap_image(&mut self, rgba_data: &Uint8ClampedArray, width: f64, height: f64) -> Result<Uint8ClampedArray, JsValue> {
        let (w, h, pixels) = checked_dimensions(width, height)?;
        if rgba_data.length() as usize != pixels * 4 {
            return Err(JsValue::from_str("Image data length doesn't match width * height * 4"));
        }

        let rgba_pixels: Vec<RGBA> = rgba_data.to_vec()
            .chunks_exact(4)
            .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
            .collect();

        let temp_attr = Attributes::new();
        let mut img = Image::new_borrowed(&temp_attr, &rgba_pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("Failed to create image: {:?}", e)))?;

        let (palette, indices) = self.result.remapped(&mut img)
            .map_err(|e| JsValue::from_str(&format!("Failed to remap image: {:?}", e)))?;

        let pixel_count = w * h;
        if indices.len() != pixel_count {
            return Err(JsValue::from_str(&format!(
                "Index data length mismatch: got {} indices, expected {}",
                indices.len(), pixel_count
            )));
        }

        // Convert indices back to RGBA using the palette
        let mut result_data = Vec::with_capacity(pixel_count * 4);
        for palette_index in indices {
            let index = palette_index as usize;
            if index < palette.len() {
                let color = &palette[index];
                result_data.push(color.r);
                result_data.push(color.g);
                result_data.push(color.b);
                result_data.push(color.a);
            } else {
                result_data.extend_from_slice(&[0, 0, 0, 255]);
            }
        }

        Ok(Uint8ClampedArray::from(&result_data[..]))
    }

    #[wasm_bindgen(js_name = getPaletteIndices)]
    pub fn get_palette_indices(&mut self, rgba_data: &Uint8ClampedArray, width: f64, height: f64) -> Result<Uint8Array, JsValue> {
        let (w, h, pixels) = checked_dimensions(width, height)?;
        if rgba_data.length() as usize != pixels * 4 {
            return Err(JsValue::from_str("Image data length doesn't match width * height * 4"));
        }

        let rgba_pixels: Vec<RGBA> = rgba_data.to_vec()
            .chunks_exact(4)
            .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
            .collect();

        let temp_attr = Attributes::new();
        let mut img = Image::new_borrowed(&temp_attr, &rgba_pixels, w, h, 0.0)
            .map_err(|e| JsValue::from_str(&format!("Failed to create image: {:?}", e)))?;

        let (_palette, indices) = self.result.remapped(&mut img)
            .map_err(|e| JsValue::from_str(&format!("Failed to remap image: {:?}", e)))?;

        let pixel_count = w * h;
        if indices.len() != pixel_count {
            return Err(JsValue::from_str(&format!(
                "Index data length mismatch: got {} indices, expected {}",
                indices.len(), pixel_count
            )));
        }

        Ok(Uint8Array::from(&indices[..]))
    }
}

// PNG helper functions
#[wasm_bindgen]
pub fn decode_png_to_rgba(png_bytes: &Uint8Array) -> Result<Array, JsValue> {
    let data: Vec<u8> = png_bytes.to_vec();
    let cursor = Cursor::new(data);
    
    let mut decoder = Decoder::new(cursor);
    // Normalize every supported PNG to eight-bit channels before RGBA conversion.
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    let mut reader = decoder.read_info()
        .map_err(|e| JsValue::from_str(&format!("Failed to read PNG info: {}", e)))?;
    
    checked_dimensions(reader.info().width as f64, reader.info().height as f64)?;

    // Allocate the output buffer only after bounding the normalized RGBA size.
    let mut buf = vec![0; reader.output_buffer_size()
        .ok_or_else(|| JsValue::from_str("PNG output buffer size overflow"))?];
    
    // Read the next frame. An APNG might contain multiple frames.
    let info = reader.next_frame(&mut buf)
        .map_err(|e| JsValue::from_str(&format!("Failed to read PNG frame: {}", e)))?;

    // Truncate buffer to actual frame data
    let buf = &buf[..info.buffer_size()];

    // Convert to RGBA if needed
    let rgba_buf = match info.color_type {
        ColorType::Rgba => buf.to_vec(),
        ColorType::Rgb => {
            let mut rgba_buf = Vec::with_capacity(buf.len() / 3 * 4);
            for chunk in buf.chunks_exact(3) {
                rgba_buf.extend_from_slice(chunk);
                rgba_buf.push(255); // Add alpha channel
            }
            rgba_buf
        },
        ColorType::GrayscaleAlpha => {
            let mut rgba_buf = Vec::with_capacity(buf.len() * 2);
            for chunk in buf.chunks_exact(2) {
                let gray = chunk[0];
                let alpha = chunk[1];
                rgba_buf.extend_from_slice(&[gray, gray, gray, alpha]);
            }
            rgba_buf
        },
        ColorType::Grayscale => {
            let mut rgba_buf = Vec::with_capacity(buf.len() * 4);
            for &gray in buf {
                rgba_buf.extend_from_slice(&[gray, gray, gray, 255]);
            }
            rgba_buf
        },
        _ => return Err(JsValue::from_str("Unsupported PNG color type")),
    };
    
    let result = Array::new();
    result.push(&Uint8ClampedArray::from(&rgba_buf[..]));
    result.push(&JsValue::from(info.width));
    result.push(&JsValue::from(info.height));
    
    Ok(result)
}

#[wasm_bindgen]
pub fn encode_palette_to_png(palette_indices: &Uint8Array, palette: &Array, width: f64, height: f64) -> Result<Uint8Array, JsValue> {
    let (w, h, pixel_count) = checked_dimensions(width, height)?;
    if palette_indices.length() as usize != pixel_count {
        return Err(JsValue::from_str("Palette indices length doesn't match width * height"));
    }
    
    let indices = palette_indices.to_vec();
    // Convert JS palette to Vec<RGBA>
    let mut palette_colors = Vec::new();
    for i in 0..palette.length() {
        let color = palette.get(i);
        if let Ok(color_array) = color.dyn_into::<Array>() {
            if color_array.length() >= 4 {
                let r = color_array.get(0).as_f64().unwrap_or(0.0) as u8;
                let g = color_array.get(1).as_f64().unwrap_or(0.0) as u8;
                let b = color_array.get(2).as_f64().unwrap_or(0.0) as u8;
                let a = color_array.get(3).as_f64().unwrap_or(255.0) as u8;
                palette_colors.push([r, g, b, a]);
            } else {
                return Err(JsValue::from_str("Invalid palette color format"));
            }
        } else {
            return Err(JsValue::from_str("Invalid palette format"));
        }
    }
    
    if palette_colors.len() > 256 {
        return Err(JsValue::from_str("Palette too large for PNG (max 256 colors)"));
    }
    if palette_colors.is_empty() {
        return Err(JsValue::from_str("Palette must contain at least one color"));
    }
    if indices.iter().any(|&index| index as usize >= palette_colors.len()) {
        return Err(JsValue::from_str("Palette index is outside the palette"));
    }
    
    let mut png_data = Vec::new();
    {
        let mut encoder = Encoder::new(Cursor::new(&mut png_data), w as u32, h as u32);
        encoder.set_color(ColorType::Indexed);
        encoder.set_depth(BitDepth::Eight);
        
        // Set up palette and tRNS chunk
        let mut palette_rgb = Vec::new();
        let mut all_alpha = Vec::new();
        for color in &palette_colors {
            palette_rgb.extend_from_slice(&[color[0], color[1], color[2]]);
            all_alpha.push(color[3]);
        }

        encoder.set_palette(palette_rgb);
        // tRNS must include entries for indices 0..=last_non_opaque
        if let Some(last_non_opaque) = all_alpha.iter().rposition(|&a| a < 255) {
            encoder.set_trns(all_alpha[..=last_non_opaque].to_vec());
        }
        
        let mut writer = encoder.write_header()
            .map_err(|e| JsValue::from_str(&format!("Failed to write PNG header: {}", e)))?;
        
        writer.write_image_data(&indices)
            .map_err(|e| JsValue::from_str(&format!("Failed to write PNG data: {}", e)))?;
    }
    
    Ok(Uint8Array::from(&png_data[..]))
}
