use wasm_bindgen::prelude::*;
use js_sys::{Array, Uint8Array, Uint8ClampedArray};
use imagequant::{Attributes, Image, RGBA};
use png::{Decoder, Encoder, ColorType, BitDepth};
use std::io::Cursor;

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
    pub fn set_speed(&mut self, speed: i32) -> Result<(), JsValue> {
        self.attr.set_speed(speed)
            .map_err(|e| JsValue::from_str(&format!("Failed to set speed: {:?}", e)))
    }

    #[wasm_bindgen(js_name = setQuality)]
    pub fn set_quality(&mut self, min: u8, target: u8) -> Result<(), JsValue> {
        self.attr.set_quality(min, target)
            .map_err(|e| JsValue::from_str(&format!("Failed to set quality: {:?}", e)))
    }

    #[wasm_bindgen(js_name = setMaxColors)]
    pub fn set_max_colors(&mut self, colors: u32) -> Result<(), JsValue> {
        self.attr.set_max_colors(colors)
            .map_err(|e| JsValue::from_str(&format!("Failed to set max colors: {:?}", e)))
    }

    #[wasm_bindgen(js_name = setPosterization)]
    pub fn set_posterization(&mut self, posterization: f64) -> Result<(), JsValue> {
        self.attr.set_min_posterization(posterization as u8)
            .map_err(|e| JsValue::from_str(&format!("Failed to set posterization: {:?}", e)))
    }

    #[wasm_bindgen(js_name = quantizeImage)]
    pub fn quantize_image(&mut self, rgba_data: &Uint8ClampedArray, width: u32, height: u32) -> Result<QuantizationResult, JsValue> {
        let data: Vec<u8> = rgba_data.to_vec();
        
        if data.len() != (width * height * 4) as usize {
            return Err(JsValue::from_str("Image data length doesn't match width * height * 4"));
        }

        // Convert u8 data to RGBA array
        let rgba_pixels: Vec<RGBA> = data
            .chunks_exact(4)
            .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
            .collect();

        let mut img = Image::new(&mut self.attr, rgba_pixels.into_boxed_slice(), width as usize, height as usize, 0.0)
            .map_err(|e| JsValue::from_str(&format!("Failed to create image: {:?}", e)))?;

        let result = self.attr.quantize(&mut img)
            .map_err(|e| JsValue::from_str(&format!("Failed to quantize image: {:?}", e)))?;

        Ok(QuantizationResult { 
            result,
            width: width as usize,
            height: height as usize,
        })
    }

}

#[wasm_bindgen]
#[derive(Clone)]
pub struct QuantizationResult {
    result: imagequant::QuantizationResult,
    width: usize,
    height: usize,
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
    pub fn set_dithering(&mut self, dithering_level: f32) -> Result<(), JsValue> {
        self.result.set_dithering_level(dithering_level)
            .map_err(|e| JsValue::from_str(&format!("Failed to set dithering: {:?}", e)))
    }

    #[wasm_bindgen(js_name = remapImage)]
    pub fn remap_image(&mut self, rgba_data: &Uint8ClampedArray, width: u32, height: u32) -> Result<Uint8ClampedArray, JsValue> {
        let data: Vec<u8> = rgba_data.to_vec();
        
        if data.len() != (width * height * 4) as usize {
            return Err(JsValue::from_str("Image data length doesn't match width * height * 4"));
        }

        let rgba_pixels: Vec<RGBA> = data
            .chunks_exact(4)
            .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
            .collect();

        let temp_attr = Attributes::new();
        let mut img = Image::new_borrowed(&temp_attr, &rgba_pixels, width as usize, height as usize, 0.0)
            .map_err(|e| JsValue::from_str(&format!("Failed to create image: {:?}", e)))?;

        let (palette, indices) = self.result.remapped(&mut img)
            .map_err(|e| JsValue::from_str(&format!("Failed to remap image: {:?}", e)))?;

        // Verify we got the expected number of indices
        if indices.len() != (width * height) as usize {
            return Err(JsValue::from_str(&format!(
                "Index data length mismatch: got {} indices, expected {}", 
                indices.len(), width * height
            )));
        }

        // Convert indices back to RGBA using the palette
        let mut result_data = Vec::with_capacity((width * height * 4) as usize);
        for palette_index in indices {
            // palette_index is a u8 representing the index into the palette
            let index = palette_index as usize;
            if index < palette.len() {
                let color = &palette[index];
                result_data.push(color.r);
                result_data.push(color.g);
                result_data.push(color.b);
                result_data.push(color.a);
            } else {
                // Fallback to black if index is out of bounds
                result_data.extend_from_slice(&[0, 0, 0, 255]);
            }
        }

        Ok(Uint8ClampedArray::from(&result_data[..]))
    }

    #[wasm_bindgen(js_name = getPaletteIndices)]
    pub fn get_palette_indices(&mut self, rgba_data: &Uint8ClampedArray, width: u32, height: u32) -> Result<Uint8Array, JsValue> {
        let data: Vec<u8> = rgba_data.to_vec();
        
        if data.len() != (width * height * 4) as usize {
            return Err(JsValue::from_str("Image data length doesn't match width * height * 4"));
        }

        let rgba_pixels: Vec<RGBA> = data
            .chunks_exact(4)
            .map(|chunk| RGBA::new(chunk[0], chunk[1], chunk[2], chunk[3]))
            .collect();

        let temp_attr = Attributes::new();
        let mut img = Image::new_borrowed(&temp_attr, &rgba_pixels, width as usize, height as usize, 0.0)
            .map_err(|e| JsValue::from_str(&format!("Failed to create image: {:?}", e)))?;

        let (_palette, indices) = self.result.remapped(&mut img)
            .map_err(|e| JsValue::from_str(&format!("Failed to remap image: {:?}", e)))?;

        // Verify we got the expected number of indices
        if indices.len() != (width * height) as usize {
            return Err(JsValue::from_str(&format!(
                "Index data length mismatch: got {} indices, expected {}", 
                indices.len(), width * height
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
    
    let decoder = Decoder::new(cursor);
    let mut reader = decoder.read_info()
        .map_err(|e| JsValue::from_str(&format!("Failed to read PNG info: {}", e)))?;
    
    // Allocate the output buffer.
    let mut buf = vec![0; reader.output_buffer_size()];
    
    // Read the next frame. An APNG might contain multiple frames.
    let info = reader.next_frame(&mut buf)
        .map_err(|e| JsValue::from_str(&format!("Failed to read PNG frame: {}", e)))?;
    
    // Convert to RGBA if needed
    let rgba_buf = match info.color_type {
        ColorType::Rgba => buf,
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
            for &gray in &buf {
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
pub fn encode_palette_to_png(palette_indices: &Uint8Array, palette: &Array, width: u32, height: u32) -> Result<Uint8Array, JsValue> {
    let indices: Vec<u8> = palette_indices.to_vec();
    
    if indices.len() != (width * height) as usize {
        return Err(JsValue::from_str("Palette indices length doesn't match width * height"));
    }
    
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
    
    let mut png_data = Vec::new();
    {
        let mut encoder = Encoder::new(Cursor::new(&mut png_data), width, height);
        encoder.set_color(ColorType::Indexed);
        encoder.set_depth(BitDepth::Eight);
        
        // Set up palette
        let mut palette_rgb = Vec::new();
        let mut transparency = Vec::new();
        for color in &palette_colors {
            palette_rgb.extend_from_slice(&[color[0], color[1], color[2]]);
            if color[3] < 255 {
                transparency.push(color[3]);
            }
        }
        
        encoder.set_palette(palette_rgb);
        if !transparency.is_empty() {
            encoder.set_trns(transparency);
        }
        
        let mut writer = encoder.write_header()
            .map_err(|e| JsValue::from_str(&format!("Failed to write PNG header: {}", e)))?;
        
        writer.write_image_data(&indices)
            .map_err(|e| JsValue::from_str(&format!("Failed to write PNG data: {}", e)))?;
    }
    
    Ok(Uint8Array::from(&png_data[..]))
}