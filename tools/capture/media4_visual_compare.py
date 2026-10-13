# Pass-4 visual polish (helper F): before (pass-03 screens) / after (pass-04 visual/<tag>) crops and measurements.
# python tools/capture/media4_visual_compare.py [after-tag]   -> E:/shots/skate-park/pass-04/visual/cmp_*.jpg + measurements.txt
import sys
import numpy as np
from PIL import Image, ImageDraw

P3 = 'E:/shots/skate-park/pass-03/screens/'
OUT = 'E:/shots/skate-park/pass-04/visual/'
P4 = OUT + (sys.argv[1] if len(sys.argv) > 1 else 'after3') + '/'
lines = []


def log(s):
    print(s)
    lines.append(s)


def img(p):
    try:
        return Image.open(p).convert('RGB')
    except FileNotFoundError:
        im = Image.new('RGB', (1280, 720), (40, 40, 40))
        ImageDraw.Draw(im).text((20, 20), 'missing: ' + p, fill=(255, 80, 80))
        return im


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def med(p, box):
    a = np.asarray(img(p).crop(box)).reshape(-1, 3).astype(float)
    m = np.median(a, axis=0)
    return '%3d/%3d/%3d (lum %3d)' % (m[0], m[1], m[2], np.median(lum(a)))


def sheet(cells, cols, w, h, path, title=''):
    """cells: (label, PIL image) in reading order"""
    rows = (len(cells) + cols - 1) // cols
    top = 22 if title else 0
    out = Image.new('RGB', (cols * w, top + rows * (h + 18)), (0, 0, 0))
    d = ImageDraw.Draw(out)
    if title:
        d.text((6, 5), title, fill=(255, 255, 255))
    for i, (lab, im) in enumerate(cells):
        x, y = (i % cols) * w, top + (i // cols) * (h + 18)
        out.paste(im.resize((w, h), Image.LANCZOS), (x, y + 18))
        d.text((x + 4, y + 3), lab, fill=(255, 230, 0))
    out.save(path, quality=92)


def crop(p, box, s=1):
    im = img(p).crop(box)
    return im.resize((im.size[0] * s, im.size[1] * s), Image.LANCZOS) if s != 1 else im


# ------------------------------------------------------------------ #68 grip in sun
log('#68 grip: median RGB (luminance) of the board top vs the sunlit concrete')
for n, boxes in [('b_5050', {'nose (sun)': (672, 618, 700, 632), 'tail (sun)': (525, 575, 550, 590), 'concrete (sun)': (900, 560, 1000, 620)}),
                 ('b_manual', {'tail (sun)': (575, 625, 600, 648), 'middle (shade)': (640, 590, 680, 610), 'concrete (sun)': (900, 600, 1000, 660)})]:
    for k, b in boxes.items():
        log('  %-9s %-15s pass-03 %s   pass-04 %s' % (n, k, med(P3 + n + '.png', b), med(P4 + n + '.png', b)))
log('  h64 mid-flip, grip facing the sun  pass-03 %s   pass-04 %s   (concrete %s)' % (
    med(P3 + 'h64_grip_kickflip_sunlit.png', (520, 370, 600, 410)), med(P4 + 'h64_grip_kickflip_sunlit.png', (520, 370, 600, 410)),
    med(P4 + 'h64_grip_kickflip_sunlit.png', (800, 560, 1000, 640))))
g = [('pass-03 b_5050 2x', crop(P3 + 'b_5050.png', (480, 500, 760, 680), 2)), ('pass-04 b_5050 2x', crop(P4 + 'b_5050.png', (480, 500, 760, 680), 2)),
     ('pass-04 b_5050 noon 2x', crop(P4 + 'b_5050_noon.png', (480, 500, 760, 680), 2)),
     ('pass-03 b_manual 2x', crop(P3 + 'b_manual.png', (560, 520, 840, 700), 2)), ('pass-04 b_manual 2x', crop(P4 + 'b_manual.png', (560, 520, 840, 700), 2)),
     ('pass-04 b_manual noon 2x', crop(P4 + 'b_manual_noon.png', (560, 520, 840, 700), 2)),
     ('pass-03 h64_grip_kickflip_sunlit', img(P3 + 'h64_grip_kickflip_sunlit.png')), ('pass-04 h64_grip_kickflip_sunlit', img(P4 + 'h64_grip_kickflip_sunlit.png')),
     ('pass-04 manual, board height, sun', img(P4 + 'manual_board_height_sun_toe.png')),
     ('pass-03 g_backlight_golden_close', img(P3 + 'g_backlight_golden_close.png')), ('pass-04 g_backlight_golden_close', img(P4 + 'g_backlight_golden_close.png')),
     ('pass-04 manual, board height, noon', img(P4 + 'manual_board_height_sun_noon_toe.png')),
     ('KEEP pass-03 b_kickflip_mid (shade)', img(P3 + 'b_kickflip_mid.png')), ('KEEP pass-04 b_kickflip_mid (shade)', img(P4 + 'b_kickflip_mid.png')),
     ('pass-04 manual, board height, heel side', img(P4 + 'manual_board_height_sun_heel.png'))]
sheet(g, 3, 560, 360, OUT + 'cmp_68_grip_sun.jpg', '#68 grip in direct sun: pass-03 (left) vs pass-04; noon and board height (right column)')

# ------------------------------------------------------------------ #69 kiosk at blue hour
log('#69 kiosk at blue hour: share of the frame darker than 18/255 (luminance)')
cells = []
for n in ['h58_kiosk_town_side_blue_hour', 'h58_kiosk_window_oblique_blue_hour', 'h58_kiosk_window_close_blue_hour', 'e_blue_hour_lamps_wide', 'e_blue_hour_lamps_south', 'e_blue_hour', 'e_blue_hour_wide']:
    r = []
    for tag, p in [('pass-03', P3 + n + '.png'), ('pass-04', P4 + n + '.png')]:
        im = img(p)
        a = np.asarray(im).astype(float)
        m = lum(a) < 18
        r.append(100 * m.mean())
        if n.startswith('h58') and 'close' not in n:
            mk = a.copy()
            mk[m] = [255, 0, 255]
            cells.append(('%s %s (%.1f%% < 18)' % (tag, n.replace('h58_kiosk_', ''), 100 * m.mean()), im))
            cells.append(('%s mask' % tag, Image.fromarray(mk.astype(np.uint8))))
    log('  %-38s pass-03 %5.1f%%   pass-04 %5.1f%%' % (n, r[0], r[1]))
for x, y, lab in [(120, 300, 'wall, far left'), (1150, 300, 'wall, far right'), (640, 230, 'roof edge')]:
    a3, a4 = np.asarray(img(P3 + 'h58_kiosk_town_side_blue_hour.png')), np.asarray(img(P4 + 'h58_kiosk_town_side_blue_hour.png'))
    log('  town side %-16s pass-03 %s   pass-04 %s' % (lab, tuple(a3[y, x]), tuple(a4[y, x])))
sheet(cells, 4, 400, 225, OUT + 'cmp_69_kiosk_blue_hour.jpg', '#69 kiosk town side at blue hour: magenta = darker than 18/255')

# ------------------------------------------------------------------ #70 background boards
log('#70 background boards: board top median (west steps, from above)')
log('  h60_west_steps_above board  pass-03 %s   pass-04 %s' % (med(P3 + 'h60_west_steps_above.png', (935, 450, 990, 468)), med(P4 + 'h60_west_steps_above.png', (935, 450, 990, 468))))
b = [('pass-03 h60_west_steps_above (board right) 2x', crop(P3 + 'h60_west_steps_above.png', (700, 380, 1020, 560), 2)),
     ('pass-04 h60_west_steps_above 2x', crop(P4 + 'h60_west_steps_above.png', (700, 380, 1020, 560), 2)),
     ('pass-04 west steps board close', img(P4 + 'board_west_steps_close.png')),
     ('pass-04 west steps board close, blue hour', img(P4 + 'board_west_steps_close_blue_hour.png')),
     ('pass-04 north-deck skater board close', img(P4 + 'board_north_deck_close.png')),
     ('pass-04 half-pipe deck leaning board', img(P4 + 'board_hp_deck_lean_close.png')),
     ('pass-03 d_people_north_deck', img(P3 + 'd_people_north_deck.png')), ('pass-04 d_people_north_deck', img(P4 + 'd_people_north_deck.png')),
     ('pass-04 d_people_hp_deck', img(P4 + 'd_people_hp_deck.png'))]
sheet(b, 3, 560, 315, OUT + 'cmp_70_background_boards.jpg', '#70 background boards: hero-board grip, ply edge, wheels, graphic')

# ------------------------------------------------------------------ #71 hair and leaf edges
def hf(p, box):
    """mean |pixel - mean of its 4 neighbours| on luminance: the stipple / glitter energy of a region"""
    a = lum(np.asarray(img(p).crop(box)).astype(float))
    c = a[1:-1, 1:-1]
    nb = 0.25 * (a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:])
    return np.abs(c - nb).mean()


def checker(p, box):
    """2x2 checkerboard (ordered-dither) energy: |a - b - c + d| over every 2x2 block, on luminance"""
    a = lum(np.asarray(img(p).crop(box)).astype(float))
    h, w = (a.shape[0] // 2) * 2, (a.shape[1] // 2) * 2
    a = a[:h, :w]
    return np.abs(a[0::2, 0::2] - a[0::2, 1::2] - a[1::2, 0::2] + a[1::2, 1::2]).mean() / 4


n = 'h57_bush_xclose_town_scrub'
for lab, box in [('whole bush', (240, 80, 1000, 560)), ('shaded clump', (300, 200, 620, 450)), ('sunlit side', (640, 200, 960, 440))]:
    log('#71 leaves %-13s 4-neighbour energy pass-03 %.2f  pass-04 %.2f | 2x2 checker energy pass-03 %.2f  pass-04 %.2f' % (
        lab, hf(P3 + n + '.png', box), hf(P4 + n + '.png', box), checker(P3 + n + '.png', box), checker(P4 + n + '.png', box)))
lc = [('pass-03 town scrub shaded clump 2x', crop(P3 + n + '.png', (300, 90, 620, 330), 2)), ('pass-04 2x', crop(P4 + n + '.png', (300, 90, 620, 330), 2)),
      ('pass-03 sunlit side 2x', crop(P3 + n + '.png', (640, 200, 960, 440), 2)), ('pass-04 2x', crop(P4 + n + '.png', (640, 200, 960, 440), 2)),
      ('pass-03 6x (nearest)', img(P3 + n + '.png').crop((700, 330, 780, 390)).resize((480, 360), Image.NEAREST)),
      ('pass-04 6x (nearest)', img(P4 + n + '.png').crop((700, 330, 780, 390)).resize((480, 360), Image.NEAREST))]
sheet(lc, 2, 640, 480, OUT + 'cmp_71_leaf_edges.jpg', '#71 leaf edges in the extreme close-up (h57_bush_xclose_town_scrub)')

# ------------------------------------------------------------------ #73 agave
ag = [('pass-03 h57_bush_xclose_flowering_side (agave bottom right)', crop(P3 + 'h57_bush_xclose_flowering_side.png', (870, 380, 1280, 720))),
      ('pass-04 same camera', crop(P4 + 'h57_bush_xclose_flowering_side.png', (870, 380, 1280, 720))),
      ('pass-04 agave close, side', img(P4 + 'agave_xclose_side.png')), ('pass-04 agave close, other side', img(P4 + 'agave_xclose_side_b.png')),
      ('pass-04 agave close, backlit', img(P4 + 'agave_xclose_back.png')), ('pass-04 agave close, noon', img(P4 + 'agave_xclose_side_noon.png'))]
sheet(ag, 2, 640, 400, OUT + 'cmp_73_agave.jpg', '#73 planter agave')

# ------------------------------------------------------------------ keep list (same cameras)
keep = ['d_edge_east', 'd_edge_west', 'h57_bush_backlit_west_planter', 'h57_bush_xclose_planter_backlit', 'h58_kiosk_window_close_golden', 'h58_kiosk_town_side_golden',
        'h60_west_steps_above', 'h60_west_steps_above_blue_hour', 'h60_west_steps_above_noon', 'h60_skater_hair_above', 'h59_walker_face_3m', 'b_face_closeup',
        'e_golden_hour_wide', 'e_sunset_wide', 'e_blue_hour_wide', 'e_bright_noon_wide', 'e_blue_hour_lamps_wide', 'g_frontlight_golden']
cells = []
for k in keep:
    cells += [('pass-03 ' + k, img(P3 + k + '.png')), ('pass-04 ' + k, img(P4 + k + '.png'))]
    a3, a4 = np.asarray(img(P3 + k + '.png')).astype(float), np.asarray(img(P4 + k + '.png')).astype(float)
    log('keep %-34s mean abs diff %.1f / 255, mean luminance pass-03 %.1f pass-04 %.1f' % (k, np.abs(a3 - a4).mean(), lum(a3).mean(), lum(a4).mean()))
sheet(cells, 4, 400, 225, OUT + 'cmp_keep.jpg', 'Keep list: pass-03 / pass-04 pairs, same cameras')

hair = []
for nm, box in [('h59_north_deck_skater_face_3m', (560, 260, 720, 380)), ('h59_kiosk_vendor_3m', (560, 190, 720, 330)), ('h59_shore_walker_face_3m', (560, 200, 720, 340)),
                ('h59_hp_deck_skater_face_3m', (560, 230, 720, 370))]:
    hair += [('pass-03 ' + nm + ' 3x', crop(P3 + nm + '.png', box, 3)), ('pass-04 3x', crop(P4 + nm + '.png', box, 3))]
sheet(hair, 4, 400, 320, OUT + 'cmp_71_hair_3x.jpg', '#71 hair under caps at 3 m (3x crops; the walkers move, so poses differ)')
open(OUT + 'measurements.txt', 'w').write('\n'.join(lines) + '\n')
