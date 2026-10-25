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

`beach-ball-45.apng` is DiriectorDoc's 45 × 45, 20-frame **APNG bouncing beach ball**,
downloaded unchanged under CC0. It provides a second independently authored real animation.

- [Source and CC0 declaration](<https://commons.wikimedia.org/wiki/File:APNG_bouncing_beach_ball_(45px).png>)
- [Original file](https://upload.wikimedia.org/wikipedia/commons/2/24/APNG_bouncing_beach_ball_%2845px%29.png)
- SHA-256: `cbf0b58d8741a578fcd3e181584e7950123d0a02039009ef11d5707af117522d`
