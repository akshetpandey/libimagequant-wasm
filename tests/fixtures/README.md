# PNG fixtures

`beach-ball.apng` is Holger Will's **Animated PNG example bouncing beach ball**,
downloaded unchanged from Wikimedia Commons. It is a real 100 × 100 RGBA APNG
with 20 frames, 75 ms frame delays, infinite looping, offset rectangles,
transparency, and background disposal. The author released it into the public
domain.

- [Source and public-domain declaration](https://commons.wikimedia.org/wiki/File:Animated_PNG_example_bouncing_beach_ball.png)
- [Original file](https://upload.wikimedia.org/wikipedia/commons/1/14/Animated_PNG_example_bouncing_beach_ball.png)
- SHA-256: `3b28e2462f1b31d0d15d795e6e58baf397899c3f864be7034bf47939b5bbbc3b`

Tests read the checked-in file without network access. Node tests independently
decode every output frame using zlib and PNG filters. Chromium's native
`ImageDecoder` checks both the source compositing and the encoded output. Visible
pixel comparisons use premultiplied RGBA so transparent RGB values do not create
false mismatches.

`png-16bit.json` contains small generated static PNG cases. Synthetic APNG cases
in `tests/integration/apng-fixtures.mjs` supplement the real file with blend,
disposal, bit-depth, interlace, and malformed-stream cases.
