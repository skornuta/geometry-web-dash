# Minimal unicorn harness for running GD 2.2081 arm64 functions in isolation.
#
# Needs the `unicorn` Python package (GD_UNICORN_PATH may point at a directory
# that has it) and the thin arm64 slice of the Steam binary (GD_SLICE):
#
#   dd if="<Geometry Dash binary>" of=gd_arm64 bs=1 skip=11026432 count=9996432
#
# Segment layout is the slice's own (__TEXT file offset 0 at 0x100000000, so a
# geode `m1` address A is at 0x100000000 + A). Calls out of the function under
# test are stubbed: they are logged and return 0 (or `fixed_ret[addr]`), and
# `handlers[addr]` can side-effect memory. Virtual calls through a vtable the
# caller builds land on `vslots`. Unmapped reads give zeros.
import os, sys, struct
if os.environ.get('GD_UNICORN_PATH'):
    sys.path.insert(0, os.environ['GD_UNICORN_PATH'])
from unicorn import *
from unicorn.arm64_const import *

BIN = os.environ.get('GD_SLICE', '/tmp/gdwork/gd_arm64')
data = open(BIN, 'rb').read()
BASE = 0x100000000

class Emu:
    def __init__(self):
        self.uc = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        uc = self.uc
        uc.mem_map(BASE, 0x7c4000)
        uc.mem_write(BASE, data[0:0x7c4000])
        uc.mem_map(0x1007c4000, 0xec000)
        uc.mem_write(0x1007c4000, data[8142848:8142848 + 966656])
        uc.mem_map(0x1008b0000, 0x10000)
        uc.mem_write(0x1008b0000, data[9109504:9109504 + 32768])
        for a, s in [(0x20000000, 0x100000), (0x30000000, 0x100000), (0x40000000, 0x10000)]:
            uc.mem_map(a, s)
        # ret instructions in the stub region
        uc.mem_write(0x40000000, struct.pack('<I', 0xd65f03c0) * (0x10000 // 4))
        self.calls = []
        self.vslots = {}
        self.ret_override = {}
        self.range = (0, 0)
        self.ranges = []
        uc.hook_add(UC_HOOK_CODE, self.on_code)
        def unm(u, access, addr, size, val, ud):
            base = addr & ~0xfff
            try:
                u.mem_map(base, 0x1000)
            except UcError:
                return False
            return True
        uc.hook_add(UC_HOOK_MEM_READ_UNMAPPED | UC_HOOK_MEM_WRITE_UNMAPPED, unm)
        def fetch(u, access, addr, size, val, ud):
            base = addr & ~0xfff
            try:
                u.mem_map(base, 0x1000)
                u.mem_write(base, struct.pack('<I', 0xd65f03c0) * 1024)
            except UcError:
                return False
            return True
        uc.hook_add(UC_HOOK_MEM_FETCH_UNMAPPED, fetch)
        self.fixed_ret = {}
        self.handlers = {}

    def w(self, a, fmt, v): self.uc.mem_write(a, struct.pack('<' + fmt, v))
    def r(self, a, fmt):
        n = struct.calcsize(fmt)
        return struct.unpack('<' + fmt, bytes(self.uc.mem_read(a, n)))[0]

    def on_code(self, uc, addr, size, ud):
        if self.range[0] <= addr < self.range[1] or any(a <= addr < b for a, b in self.ranges):
            return
        if 0x40000000 <= addr < 0x40010000:
            slot = (addr - 0x40000000) // 4 * 8
            x0 = uc.reg_read(UC_ARM64_REG_X0)
            s0v = struct.unpack('<f', struct.pack('<I', uc.reg_read(UC_ARM64_REG_S0) & 0xffffffff))[0]
            self.calls.append(('virt', hex(slot), x0, s0v))
            uc.reg_write(UC_ARM64_REG_X0, self.vslots.get(slot, 0))
            uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_LR))
            return
        if addr >= 0x1000 and (addr < BASE or addr >= BASE + 0x7c4000):
            return
        # callee entry
        regs = [uc.reg_read(UC_ARM64_REG_X0 + i) for i in range(4)]
        s0 = struct.unpack('<f', struct.pack('<I', uc.reg_read(UC_ARM64_REG_S0) & 0xffffffff))[0]
        self.calls.append((hex(addr), [hex(x) for x in regs], s0))
        h = self.handlers.get(addr)
        if h: h(self, regs)
        uc.reg_write(UC_ARM64_REG_X0, self.fixed_ret.get(addr, 0))
        uc.reg_write(UC_ARM64_REG_PC, uc.reg_read(UC_ARM64_REG_LR))

    def call(self, fn, args, fargs=(), end_range=0x1000):
        uc = self.uc
        self.calls = []
        self.range = (fn, fn + end_range)
        sp = 0x30080000
        uc.reg_write(UC_ARM64_REG_SP, sp)
        for i, a in enumerate(args):
            uc.reg_write(UC_ARM64_REG_X0 + i, a)
        for i, f in enumerate(fargs):
            uc.reg_write(UC_ARM64_REG_S0 + i, struct.unpack('<I', struct.pack('<f', f))[0])
        uc.reg_write(UC_ARM64_REG_LR, 0x40008000)
        try:
            uc.emu_start(fn, 0x40008000, count=200000)
        except UcError as e:
            return 'ERR %s pc=%x' % (e, uc.reg_read(UC_ARM64_REG_PC))
        return 'ok'
