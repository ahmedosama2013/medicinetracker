import zlib, struct, math

BG   = (0x1a, 0x56, 0xa0)
PILL = (0xff, 0xff, 0xff)
CAP  = (0xd8, 0xe4, 0xf5)

def rounded_rect(x, y, w, h, r):
    dx = max(abs(x - w / 2) - (w / 2 - r), 0)
    dy = max(abs(y - h / 2) - (h / 2 - r), 0)
    return math.hypot(dx, dy) <= r

def seg_dist(px, py, x0, y0, x1, y1):
    vx, vy = x1 - x0, y1 - y0
    wx, wy = px - x0, py - y0
    L = vx * vx + vy * vy
    t = 0 if L == 0 else max(0, min(1, (wx * vx + wy * vy) / L))
    return math.hypot(px - (x0 + t * vx), py - (y0 + t * vy)), t

def render(size, ss=3, square=False):
    # pill capsule on a 45-degree diagonal, sized relative to the canvas
    c = size / 2
    span = size * 0.24
    ang = math.radians(-45)
    ex, ey = math.cos(ang) * span, math.sin(ang) * span
    x0, y0, x1, y1 = c - ex, c - ey, c + ex, c + ey
    rad = size * 0.135
    corner = size * 0.22

    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    fx = px + (sx + 0.5) / ss
                    fy = py + (sy + 0.5) / ss
                    if not square and not rounded_rect(fx, fy, size, size, corner):
                        continue                      # transparent outside the tile
                    col, a = BG, 1.0
                    d, t = seg_dist(fx, fy, x0, y0, x1, y1)
                    if d <= rad:
                        col = PILL if t < 0.5 else CAP
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += a
            n = ss * ss
            alpha = acc[3] / n
            if alpha <= 0:
                row += bytes((0, 0, 0, 0))
            else:
                row += bytes((round(acc[0] / acc[3]), round(acc[1] / acc[3]),
                              round(acc[2] / acc[3]), round(alpha * 255)))
        rows.append(bytes(row))
    return rows

def write_png(path, size, square=False):
    rows = render(size, square=square)
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    open(path, 'wb').write(png)
    print(path, size, len(png), 'bytes')

base = '/home/umerbutt/personal/Medicine Tracker/icons/'
write_png(base + 'icon-192.png', 192)
write_png(base + 'icon-512.png', 512)
# iOS composites the icon onto black, so this one is a full opaque square;
# iOS applies its own corner mask.
write_png(base + 'apple-touch-icon.png', 180, square=True)
