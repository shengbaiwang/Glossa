# Glossa Kai fallback

`ar-pl-ukai-cn.woff2` is the complete AR PL UKai CN face from CJKUnifonts,
converted to WOFF2 by Glossa contributors on 2026-09-09. No glyphs were removed
or redesigned. The conversion notice is also embedded in name-table record 10.
The modified font remains freely available under the **Arphic Public License
(1999)** in `ARPHICPL.txt`; `ar-pl-ukai-copyright.txt` preserves upstream credits.
This license applies to the font, independently of the application's AGPL.

Source: Debian `fonts-arphic-ukai` version `0.2.20080216.2-5`:
https://deb.debian.org/debian/pool/main/f/fonts-arphic-ukai/fonts-arphic-ukai_0.2.20080216.2-5_all.deb

Verified package SHA-256:
`b9db73184895b067f7911f9adbf3b137df99c2d4ec5425b4ad779a9834b7110b`

Output SHA-256:
`3d2f53dcbcbd9fe2983c0c2ccfe82be5d8fd723941f13f592af89100ea502c8c`

Reproduce with fonttools 4.59.0 and Brotli 1.2.0 after extracting the package:

```sh
python3 apps/readest-app/scripts/prepare-reading-kai.py /path/to/usr/share/fonts/truetype/arphic/ukai.ttc
```

The face contains 23,873 Unicode mappings and is used only when a Kai font is
selected/previewed and no preferred local Kai face is available. Windows/macOS
commercial fonts are referenced by installed family name only, never bundled.
