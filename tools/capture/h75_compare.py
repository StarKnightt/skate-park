"""Pass 5 #75: side-by-side of the critic's pass-4 EASY bowl bail board path and the pass-5 strips.

usage: python tools/capture/h75_compare.py
"""
from PIL import Image, ImageDraw, ImageFont

P5 = 'E:/shots/skate-park/pass-05/sheets/'
CRITIC = 'E:/shots/skate-park/pass-04/critic/chk_75_easy_board_path.jpg'
W = 1600
try:
    FONT = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 22)
except OSError:
    FONT = ImageFont.load_default()


def band(img, text):
    img = img.resize((W, round(img.height * W / img.width)), Image.LANCZOS)
    out = Image.new('RGB', (W, img.height + 40), (18, 18, 22))
    ImageDraw.Draw(out).text((12, 8), text, fill=(255, 220, 90), font=FONT)
    out.paste(img, (0, 40))
    return out


parts = [
    band(Image.open(CRITIC).convert('RGB'), 'PASS 4 (critic chk_75): EASY bowl bail - board balances on its rail f0856-f0900, then slides itself ~1 m to his feet'),
    band(Image.open(P5 + 'h75_easy_bowl_strip.jpg').convert('RGB'), 'PASS 5 EASY bowl bail (same camera, real time): board falls flat at once and stays put; he gets up, walks over, steps on'),
    band(Image.open(P5 + 'h75_easy_flat_strip.jpg').convert('RGB'), 'PASS 5 EASY flat-ground bail: board rolls to a stop nearby; he walks over, foot-flips it if upside down, steps on'),
]
H = sum(p.height for p in parts)
sheet = Image.new('RGB', (W, H), (18, 18, 22))
y = 0
for p in parts:
    sheet.paste(p, (0, y))
    y += p.height
sheet.save(P5 + 'h75_easy_vs_p4_critic.jpg', quality=88)
print('saved', P5 + 'h75_easy_vs_p4_critic.jpg', sheet.size)
