"""Convert the verified Debian AR PL UKai CN face to WOFF2 (fonttools 4.59.0)."""
import hashlib
import sys
from pathlib import Path
from fontTools.ttLib import TTCollection

source = Path(sys.argv[1])
collection = TTCollection(source)
font = collection.fonts[0]
assert font['name'].getDebugName(1) == 'AR PL UKai CN'
notice = ('Glossa contributors, 2026-09-09: extracted the complete AR PL UKai CN face '
          'from ukai.ttc and converted to WOFF2; no glyphs removed or redesigned. '
          'This modified font remains under the Arphic Public License (1999).')
font['name'].setName(notice, 10, 3, 1, 0x409)
font.recalcTimestamp = False
font.flavor = 'woff2'
destination = Path(__file__).resolve().parents[1] / 'public/fonts/ar-pl-ukai-cn.woff2'
font.save(destination)
print(destination.name, destination.stat().st_size, hashlib.sha256(destination.read_bytes()).hexdigest())
print('Unicode characters:', len(font.getBestCmap()))
