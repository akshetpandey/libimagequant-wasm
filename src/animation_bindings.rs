use crate::animation::{Animation, QuantizedAnimation};
use imagequant::RGBA;
use js_sys::{Array, Object, Reflect, Uint8Array, Uint8ClampedArray};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(typescript_custom_section)]
const TYPES: &str = r#"
export interface DecodedPngAnimation {
    imageData: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };
    width: number;
    height: number;
    animation: {
        numPlays: number;
        defaultImageIsFrame: boolean;
        frames: Array<{
            imageData: { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number };
            delayNumerator: number;
            delayDenominator: number;
            durationMs: number;
        }>;
    };
}
export interface PngAnimationQuantizationResult extends DecodedPngAnimation {
    palette: number[][];
    pngBytes: Uint8Array<ArrayBuffer>;
    quality: number;
    paletteLength: number;
}
"#;

fn object(fields: &[(&str, JsValue)]) -> Result<JsValue, JsValue> {
    let object = Object::new();
    for (name, value) in fields {
        Reflect::set(&object, &JsValue::from_str(name), value)?;
    }
    Ok(object.into())
}

fn image(pixels: &[RGBA], width: u32, height: u32) -> Result<JsValue, JsValue> {
    // The typed-array constructor copies into an owned JS buffer. A safe byte
    // view avoids allocating another temporary RGBA vector in WASM first.
    let bytes: &[u8] = bytemuck::cast_slice(pixels);
    object(&[
        ("data", Uint8ClampedArray::from(bytes).into()),
        ("width", width.into()),
        ("height", height.into()),
    ])
}

pub(crate) fn decoded_into_js(animation: &Animation) -> Result<JsValue, JsValue> {
    let frames = Array::new();
    for frame in &animation.frames {
        frames.push(&object(&[
            (
                "imageData",
                image(&frame.pixels, animation.width, animation.height)?,
            ),
            ("delayNumerator", frame.delay_num.into()),
            ("delayDenominator", frame.delay_den.into()),
            (
                "durationMs",
                (f64::from(frame.delay_num) * 1000.0
                    / f64::from(if frame.delay_den == 0 {
                        100
                    } else {
                        frame.delay_den
                    }))
                .into(),
            ),
        ])?);
    }
    let preview = if let Some(poster) = &animation.poster {
        image(poster, animation.width, animation.height)?
    } else {
        Reflect::get(&frames.get(0), &"imageData".into())?
    };
    object(&[
        ("imageData", preview),
        ("width", animation.width.into()),
        ("height", animation.height.into()),
        (
            "animation",
            object(&[
                ("numPlays", animation.num_plays.into()),
                ("defaultImageIsFrame", animation.poster.is_none().into()),
                ("frames", frames.into()),
            ])?,
        ),
    ])
}

pub(crate) fn into_js(result: QuantizedAnimation) -> Result<JsValue, JsValue> {
    let object = decoded_into_js(&result.animation)?;
    let palette = Array::new();
    for color in &result.palette {
        let rgba = Array::new();
        for value in [color.r, color.g, color.b, color.a] {
            rgba.push(&value.into());
        }
        palette.push(&rgba);
    }
    for (name, value) in [
        ("palette", JsValue::from(palette)),
        ("pngBytes", Uint8Array::from(result.png.as_slice()).into()),
        ("quality", result.quality.into()),
        ("paletteLength", (result.palette.len() as u32).into()),
    ] {
        Reflect::set(&object, &name.into(), &value)?;
    }
    Ok(object)
}
