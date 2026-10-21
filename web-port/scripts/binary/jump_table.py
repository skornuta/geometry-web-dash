# Writes tests/binary-jump-table.json: what the 2.2081 arm64 binary does for
# every orb, pad, gamemode change and speed row, for every gamemode, mini and
# gravity state, whether or not a native macro ever touches that combination.
#
#   python3 scripts/binary/jump_table.py > tests/binary-jump-table.json
#
# Functions run under emulation (see emu.py): `PlayerObject::ringJump` (m1
# 0x38991c), `GJBaseGameLayer::bumpPlayer` (0x1004b0, yellow/pink/red pads),
# the gravity pad function (0x1006dc), `PlayerObject::switchedToMode` (0x388338)
# plus the per-mode `toggle*Mode` helpers, `flipGravity` (0x37b40c) and
# `updateSpeedVariables` (0x374e1c). A velocity is read back in raw units
# (world = raw * 54); a gravity flip that lands after the write halves it, as
# the real flipGravity does (checked below).
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import emu as E
from emu import *

P, R, V, G, PL, L = 0x20000000, 0x20010000, 0x20020000, 0x20030000, 0x20040000, 0x20050000
MODES = ['cube', 'ship', 'ufo', 'ball', 'wave', 'robot', 'spider', 'swing']
OFF = {'ship': 0x969, 'ufo': 0x96a, 'ball': 0x96b, 'wave': 0x96c, 'robot': 0x96d, 'spider': 0x96e, 'swing': 0x974}
# object id -> GameObjectType (Geode Enums.hpp)
RING = {36: 11, 141: 12, 84: 13, 1022: 29, 1330: 32, 1333: 35}
PAD = {35: 8, 140: 9, 1332: 34, 67: 10}
TYPE = {'ship': 5, 'cube': 6, 'ball': 16, 'ufo': 19, 'wave': 26, 'robot': 27, 'spider': 33, 'swing': 41}
ENTER = {'ship': 0x38b4d8, 'ufo': 0x38bf50, 'ball': 0x38d5a0, 'wave': 0x38cf84, 'robot': 0x38d95c, 'spider': 0x38dd8c, 'swing': 0x38c5b4}
SWITCH_RANGES = [(0x388338, 0x3884b0), (0x38b4d8, 0x38b8e4), (0x38bf50, 0x38c330), (0x38c5b4, 0x38c9bc),
                 (0x38cf84, 0x38d368), (0x38d5a0, 0x38d730), (0x38d95c, 0x38dd8c), (0x38dd8c, 0x38e190)]


def setup(e, mode, mini, flipped, yvel=123.0):
    uc = e.uc
    uc.mem_write(P, b'\0' * 0x4000); uc.mem_write(R, b'\0' * 0x1000)
    for s in range(0, 0x1000, 8):
        e.w(V + s, 'Q', 0x40000000 + s // 8 * 4)
    e.w(R, 'Q', V); e.w(P, 'Q', V); e.w(L, 'Q', V)
    e.w(P + 0xbc0, 'Q', PL); e.w(P + 0x9e8, 'Q', PL)
    e.w(G + 0x1f8, 'Q', PL); e.w(G + 0x200, 'Q', PL); e.w(PL, 'Q', V)
    e.w(P + 0x858, 'Q', P + 0x2000); e.w(P + 0x850, 'Q', P + 0x2000)
    e.w(P + 0x394, 'I', 5); e.w(R + 0x394, 'I', 77)
    e.w(P + 0x788, 'd', 11.180032)               # normal-speed jump (updateSpeedVariables)
    e.w(P + 0x9a0, 'f', 0.6 if mini else 1.0)    # vehicle size
    e.w(P + 0x9a4, 'f', 0.9); e.w(P + 0xb1c, 'f', 1.0)
    e.w(P + 0x950, 'd', yvel); e.w(P + 0x971, 'B', 1)
    if mode in OFF:
        e.w(P + OFF[mode], 'B', 1)
    e.w(P + 0x96f, 'B', 1 if flipped else 0)
    e.fixed_ret[BASE + 0x300128] = G
    e.handlers[BASE + 0x37b40c] = lambda em, r: em.w(r[0] + 0x96f, 'B', r[1] & 1)
    e.handlers[BASE + 0xfd41c] = lambda em, r: em.w(r[1] + 0x96f, 'B', r[2] & 1)
    e.uc.hook_add(UC_HOOK_MEM_WRITE, lambda u, a, addr, size, val, ud:
                  e.calls.append(('W', val)) if (addr == P + 0x950 and size == 8) else None)


def effective(e, flipped, yvel=123.0):
    """replay the velocity writes and gravity flips in the order they ran"""
    v, up = yvel, bool(flipped)
    for c in e.calls:
        if c[0] == 'W':
            v = struct.unpack('<d', struct.pack('<Q', c[1] & 0xffffffffffffffff))[0]
        elif c[0] == hex(BASE + 0x37b40c) or c[0] == hex(BASE + 0xfd41c):
            t = (int(c[1][1], 16) if c[0] == hex(BASE + 0x37b40c) else int(c[1][2], 16)) & 1
            if bool(t) != up:
                up = bool(t); v /= 2
    return round(v, 6), up


def orb(rid, mode, mini, flipped):
    e = E.Emu(); setup(e, mode, mini, flipped)
    e.vslots[0x6f8] = RING[rid]
    e.fixed_ret[BASE + 0x4f9198] = 0; e.fixed_ret[BASE + 0x4f9228] = 0
    assert e.call(BASE + 0x38991c, [P, R, 1], end_range=0xd54) == 'ok'
    v, up = effective(e, flipped)
    return dict(id=rid, mode=mode, mini=mini, flipped=flipped, raw=v, gravityFlipped=up)


def pad(pid, mode, mini, flipped):
    e = E.Emu(); setup(e, mode, mini, flipped)
    e.vslots[0x6f8] = PAD[pid]
    e.fixed_ret[BASE + 0x1000cc] = 1
    if pid == 67:
        e.fixed_ret[BASE + 0x4f9198] = 1 if flipped else 0   # a pad that faces the way gravity points
        e.ranges = [(BASE + 0x38fcac, BASE + 0x38fed4)]
        r = e.call(BASE + 0x1006dc, [L, P, R], end_range=0x904 - 0x6dc)
    else:
        e.ranges = [(BASE + 0x38f9d0, BASE + 0x38fb88), (BASE + 0x38fcac, BASE + 0x38fed4)]
        r = e.call(BASE + 0x1004b0, [L, P, R], end_range=0x6dc - 0x4b0)
    assert r == 'ok', r
    v, up = effective(e, flipped)
    return dict(id=pid, mode=mode, mini=mini, flipped=flipped, raw=v, gravityFlipped=up)


def switch(frm, to):
    e = E.Emu(); setup(e, frm, 0, 0, 10.0)
    e.ranges = [(BASE + a, BASE + b) for a, b in SWITCH_RANGES]
    assert e.call(BASE + 0x388338, [P, TYPE[to]], end_range=0x178) == 'ok'
    if to in ENTER:
        assert e.call(BASE + ENTER[to], [P, 1, 0], end_range=0) == 'ok'
    return dict(from_=frm, to=to, yVelRatio=e.r(P + 0x950, 'd') / 10.0)


def flip(up, target):
    e = E.Emu(); setup(e, 'cube', 0, up, 10.0)
    assert e.call(BASE + 0x37b40c, [P, target, 0], end_range=0x768 - 0x40c) == 'ok'
    return dict(from_=bool(up), to=bool(target), yVelRatio=e.r(P + 0x950, 'd') / 10.0, gravityFlipped=bool(e.r(P + 0x96f, 'B')))


def speed_rows():
    rows = []
    for mult in (0.7, 0.9, 1.1, 1.3, 1.6):
        e = E.Emu(); e.uc.mem_write(P, b'\0' * 0x4000); e.w(P + 0x9a4, 'f', mult)
        assert e.call(BASE + 0x374e1c, [P, 0, 0], fargs=[mult], end_range=0x23c) == 'ok'
        rows.append(dict(mult=mult, xVel=round(e.r(P + 0x780, 'd'), 6), gravity=round(e.r(P + 0x790, 'd'), 6), jump=round(e.r(P + 0x788, 'd'), 6)))
    return rows


def main():
    out = dict(
        about='generated by scripts/binary/jump_table.py from the 2.2081 arm64 slice; raw = world / 54',
        orbs=[orb(r, m, mini, fl) for r in RING for m in MODES for mini in (0, 1) for fl in (0, 1)],
        pads=[pad(p, m, mini, fl) for p in PAD for m in MODES for mini in (0, 1) for fl in (0, 1)],
        switches=[switch(f, t) for f in MODES for t in MODES],
        flips=[flip(u, t) for u in (0, 1) for t in (0, 1)],
        speeds=speed_rows(),
    )
    # one entry per line keeps the diff readable
    lines = ['{']
    keys = list(out)
    for i, k in enumerate(keys):
        v = out[k]
        comma = ',' if i < len(keys) - 1 else ''
        if isinstance(v, list):
            lines.append(json.dumps(k) + ':[')
            lines += [json.dumps(x, separators=(',', ':')) + (',' if j < len(v) - 1 else '') for j, x in enumerate(v)]
            lines.append(']' + comma)
        else:
            lines.append(json.dumps(k) + ':' + json.dumps(v) + comma)
    lines.append('}')
    print('\n'.join(lines))


if __name__ == '__main__':
    main()
