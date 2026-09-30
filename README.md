# Thumbnail-Preserving Encryption

This repository combines the project website and a local, interactive implementation of the ideal Thumbnail-Preserving Encryption (TPE) construction from the NDSS 2019 paper, “Balancing Image Privacy and Usability with Thumbnail-Preserving Encryption.”

The demo accepts a PNG, JPEG, or WebP image and performs encryption and decryption inside the browser. It does not upload the image, key, or ciphertext. A module Web Worker keeps the page responsive while the construction runs.

## Run locally

```sh
npm run serve
```

Open <http://127.0.0.1:4173>. The project has no runtime dependencies and no build step.

## Verify

```sh
npm run check
npm test
```

## Implementation

The implementation follows the paper’s substitution–permutation construction for raw RGBA pixels:

1. Divide each color channel into blocks.
2. Group pixels into pairs and re-rank each pair within the set of byte pairs having the same integer sum.
3. Apply a keyed Fisher–Yates permutation within each block.
4. Repeat for the selected number of rounds.
5. Decrypt by regenerating the keyed choices and applying the inverse operations in reverse order.

AES-CTR produces the pseudorandom streams. Its key is derived from the user’s secret with PBKDF2-SHA-256 and a fresh 128-bit nonce. The nonce, dimensions, block size, round, channel, and phase separate the streams. Red, green, blue, and alpha are each transformed independently while preserving their block sums.

The paper models image dimensions as multiples of the block size. This demo also accepts other dimensions by treating right and bottom edge blocks as smaller independent blocks. Their sums are preserved in the same way.

## Scope

This is a research demonstration, not a production encryption product. The preserved thumbnail is intentional information leakage. The paper’s security result depends on a fresh nonce, a suitable number of rounds, and its stated threat model. The demo’s round control is useful for exploring the construction; it is not a security recommendation.

The original paper is bundled at [`assets/tpe-ndss19.pdf`](assets/tpe-ndss19.pdf). The canonical publication is available from the [NDSS Symposium](https://www.ndss-symposium.org/ndss-paper/balancing-image-privacy-and-usability-with-thumbnail-preserving-encryption/).

Artwork attribution is recorded in [`CREDITS.md`](CREDITS.md).
