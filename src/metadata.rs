//! Select metadata through png-rs's typed Info, never splice source PNG chunks.
use png::{ColorType, DecodeOptions, Decoder, Info, Transformations};
use std::{borrow::Cow, io::Cursor};

const MAX_METADATA_BYTES: usize = 1_048_576;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Policy {
    Safe,
    Preserve,
    None,
}

impl Policy {
    pub fn parse(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("safe") {
            "safe" => Ok(Self::Safe),
            "preserve" => Ok(Self::Preserve),
            "none" => Ok(Self::None),
            _ => Err("metadata must be 'safe', 'preserve', or 'none'".into()),
        }
    }
}

pub(crate) fn decoder(data: &[u8], policy: Policy) -> Decoder<Cursor<&[u8]>> {
    let mut options = DecodeOptions::default();
    options.set_skip_ancillary_crc_failures(false);
    let mut decoder = Decoder::new_with_options(Cursor::new(data), options);
    decoder.set_ignore_text_chunk(policy != Policy::Preserve);
    decoder.set_ignore_iccp_chunk(policy == Policy::None);
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    decoder
}

// Keep sample coordinates in their source color space. imagequant uses gAMA as
// its perceptual approximation; it does not perform an ICC color-space transform.
pub(crate) fn gamma(info: &Info<'_>) -> f64 {
    // png 0.18.1 fills the literal chunk fields; the documented derived
    // source_* fields may remain empty. sRGB takes precedence over gAMA.
    if info.srgb.is_some() {
        return 0.0;
    }
    info.source_gamma
        .or(info.gama_chunk)
        // imagequant accepts only 0..=1. Use its linear approximation for
        // unusual higher gammas, retaining the original output tag and sample
        // coordinates instead of rejecting an otherwise valid PNG.
        .map_or(0.0, |g| (g.into_value() as f64).min(1.0))
}

pub(crate) fn select(info: &Info<'static>, policy: Policy) -> Result<Info<'static>, String> {
    let mut out = Info::with_size(info.width, info.height);
    out.color_type = ColorType::Indexed;
    if policy == Policy::None {
        return Ok(out);
    }
    out.pixel_dims = info.pixel_dims;
    out.source_gamma = info.source_gamma.or(info.gama_chunk);
    out.source_chromaticities = info.source_chromaticities.or(info.chrm_chunk);
    out.srgb = info.srgb;
    // Indexed PNG requires an RGB profile, even for a grayscale source.
    let mut budget = MAX_METADATA_BYTES;
    let profile = info.icc_profile.as_ref().filter(|p| {
        p.len() >= 128 && p.get(16..20) == Some(b"RGB ") && p.get(36..40) == Some(b"acsp")
    });
    if let Some(p) = profile {
        charge(&mut budget, p.len())?;
        out.icc_profile = Some(Cow::Owned(p.to_vec()));
    }
    if policy == Policy::Preserve {
        if let Some(exif) = &info.exif_metadata {
            charge(&mut budget, exif.len())?;
            out.exif_metadata = Some(Cow::Owned(exif.to_vec()));
        }
        for text in &info.uncompressed_latin1_text {
            charge(&mut budget, text.keyword.len() + text.text.len())?;
            out.uncompressed_latin1_text.push(text.clone());
        }
        for text in &info.compressed_latin1_text {
            let mut text = text.clone();
            text.decompress_text_with_limit(budget)
                .map_err(|e| format!("PNG metadata decompression limit: {e}"))?;
            charge(
                &mut budget,
                text.keyword.len() + text.get_text().map_err(|e| e.to_string())?.len(),
            )?;
            out.compressed_latin1_text.push(text);
        }
        for text in &info.utf8_text {
            let mut text = text.clone();
            text.decompress_text_with_limit(budget)
                .map_err(|e| format!("PNG metadata decompression limit: {e}"))?;
            charge(
                &mut budget,
                text.keyword.len()
                    + text.language_tag.len()
                    + text.translated_keyword.len()
                    + text.get_text().map_err(|e| e.to_string())?.len(),
            )?;
            out.utf8_text.push(text);
        }
    }
    Ok(out)
}

fn charge(budget: &mut usize, bytes: usize) -> Result<(), String> {
    *budget = budget
        .checked_sub(bytes)
        .ok_or("PNG metadata exceeds the maximum of 1048576 bytes")?;
    Ok(())
}
