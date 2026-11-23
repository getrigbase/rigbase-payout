"""Render the RigBase Payout demo video from real CLI output + slides (PIL + ffmpeg)."""
import json, os, re, subprocess, shutil, textwrap
from PIL import Image, ImageDraw, ImageFont

ROOT = "/workspace/celo-hackathon/submission"
CAP = f"{ROOT}/cap"; FR = f"{ROOT}/frames"
W, H = 1920, 1080
BG = (11, 17, 32); CARD = (17, 26, 46); LINE = (31, 42, 68); FG = (229, 231, 235); MUT = (148, 163, 184)
Y = (252, 255, 82); G = (53, 208, 127); R = (248, 113, 113); BLUE = (125, 211, 252)
INTER = "/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf"
MONO = "/usr/share/fonts/truetype/sand-box/google/IBM Plex Mono/IBMPlexMono-Regular.ttf"
MONOB = "/usr/share/fonts/truetype/sand-box/google/IBM Plex Mono/IBMPlexMono-Bold.ttf"
_fc = {}
def F(size, w="Regular"):
    k = (size, w)
    if k not in _fc:
        f = ImageFont.truetype(INTER, size); f.set_variation_by_name(w); _fc[k] = f
    return _fc[k]
def M(size, bold=False): return ImageFont.truetype(MONOB if bold else MONO, size)
LOGO = Image.open("/workspace/celo-hackathon/rigbase-payout/assets/logo-1024.png").convert("RGBA")

def canvas():
    im = Image.new("RGB", (W, H), BG); return im, ImageDraw.Draw(im)
def caption(d, text):
    if not text: return
    d.rectangle([0, H - 96, W, H], fill=(6, 10, 20))
    d.text((W // 2, H - 48), text, font=F(34, "Medium"), fill=FG, anchor="mm")
def header(im, d, title, kicker=None):
    im.paste(LOGO.resize((64, 64)), (80, 60), LOGO.resize((64, 64)))
    d.text((164, 92), "RigBase Payout", font=F(30, "SemiBold"), fill=MUT, anchor="lm")
    if kicker: d.text((80, 175), kicker.upper(), font=F(26, "SemiBold"), fill=G)
    d.text((80, 210), title, font=F(64, "Bold"), fill=FG)
def bullets(d, items, x=80, y=340, size=40, gap=22, color=FG, width=70):
    for it in items:
        lines = textwrap.wrap(it, width)
        d.ellipse([x, y + size // 2 - 7, x + 14, y + size // 2 + 7], fill=Y)
        for i, ln in enumerate(lines):
            d.text((x + 40, y), ln, font=F(size), fill=color); y += size + 12
        y += gap
    return y
def box(d, xy, title, sub=None, color=LINE, tcol=FG):
    d.rounded_rectangle(xy, 18, fill=CARD, outline=color, width=3)
    cx = (xy[0] + xy[2]) // 2; cy = (xy[1] + xy[3]) // 2
    if sub:
        d.text((cx, cy - 22), title, font=F(32, "SemiBold"), fill=tcol, anchor="mm")
        for i, s in enumerate(sub.split("\n")): d.text((cx, cy + 18 + i * 30), s, font=F(24), fill=MUT, anchor="mm")
    else:
        d.text((cx, cy), title, font=F(32, "SemiBold"), fill=tcol, anchor="mm")
def arrow(d, a, b, color=MUT, label=None, w=4):
    d.line([a, b], fill=color, width=w)
    import math
    ang = math.atan2(b[1] - a[1], b[0] - a[0]); L = 18
    p1 = (b[0] - L * math.cos(ang - 0.45), b[1] - L * math.sin(ang - 0.45)); p2 = (b[0] - L * math.cos(ang + 0.45), b[1] - L * math.sin(ang + 0.45))
    d.polygon([b, p1, p2], fill=color)
    if label: d.text(((a[0] + b[0]) // 2, (a[1] + b[1]) // 2 - 22), label, font=F(22, "Medium"), fill=color, anchor="mm")

# ---------- frames bookkeeping
frames = []  # (path, seconds)
n = 0
def emit(im, secs):
    global n
    p = f"{FR}/f{n:05d}.png"; im.save(p); frames.append((p, secs)); n += 1

# ---------- slides
def title_card(cap="", secs=7):
    im, d = canvas()
    lg = LOGO.resize((300, 300)); im.paste(lg, (W // 2 - 150, 200), lg)
    d.text((W // 2, 590), "RigBase Payout", font=F(96, "Bold"), fill=FG, anchor="mm")
    d.text((W // 2, 680), "Cross-border contractor payroll by an agent that can't overspend.", font=F(40), fill=MUT, anchor="mm")
    d.text((W // 2, 760), "Celo mainnet  ·  Altana session wallet  ·  Textile FX  ·  ERC-8004 #10076", font=F(30, "Medium"), fill=G, anchor="mm")
    caption(d, cap); emit(im, secs)

def slide(title, items, cap, secs, kicker=None, size=40):
    im, d = canvas(); header(im, d, title, kicker); bullets(d, items, size=size); caption(d, cap); emit(im, secs)

def arch(cap, secs, save=None):
    im, d = canvas(); header(im, d, "How it works", "Architecture")
    box(d, (80, 340, 480, 480), "RigBase admin", "Altana wallet (EIP-7702)\n0x22d6…478d", Y)
    box(d, (80, 650, 480, 790), "Payout agent", "session key · CLI\npay run payroll.json", G)
    box(d, (720, 340, 1140, 480), "Altana relay", "spend policy enforced\nby the account on-chain")
    box(d, (720, 650, 1140, 790), "Textile FX RFQ v2", "firm quote USD₮→cNGN/IDRX")
    box(d, (1360, 340, 1840, 460), "Altana Keystore", "session key registered")
    box(d, (1360, 500, 1840, 620), "ERC-8004 registry", "agentId 10076")
    box(d, (1360, 670, 1840, 790), "Contractors", "cNGN · IDRX · USD₮ wallets")
    arrow(d, (430, 480), (430, 650), Y)
    d.text((100, 525), "grantSession once:", font=F(24, "SemiBold"), fill=Y)
    d.text((100, 557), "15 USD₮/week cap,", font=F(24), fill=Y); d.text((100, 589), "allowlist, 14-day expiry", font=F(24), fill=Y)
    arrow(d, (480, 720), (720, 720), MUT, "quote")
    arrow(d, (480, 670), (720, 470), G); d.text((610, 545), "tagged calls", font=F(24, "Medium"), fill=G)
    arrow(d, (1140, 390), (1360, 390), MUT, "register key")
    arrow(d, (1140, 460), (1360, 720), G); d.text((1150, 660), "approve → swap", font=F(22, "Medium"), fill=G); d.text((1150, 688), "→ transfer", font=F(22, "Medium"), fill=G)
    d.line([(280, 340), (280, 300), (1300, 300), (1300, 560)], fill=Y, width=4); arrow(d, (1300, 560), (1360, 560), Y)
    d.text((790, 278), "register(agentURI) · direct tx, tagged", font=F(22, "Medium"), fill=Y, anchor="mm")
    d.rounded_rectangle((80, 840, 1840, 915), 14, fill=(20, 24, 12), outline=Y, width=2)
    d.text((960, 877), "Every transaction we build carries the Loops attribution tag  celo_f41eab517821  (ERC-8021)", font=F(30, "SemiBold"), fill=Y, anchor="mm")
    caption(d, cap); emit(im, secs)
    if save: im.save(save)

def caps_slide(cap, secs):
    im, d = canvas(); header(im, d, "The leash: an Altana session key", "Track 4 · Altana Agent Wallets")
    rows = [("Weekly cap", "15 USD₮  ·  25,000 cNGN  ·  250,000 IDRX"), ("Fee cap", "1 USD₮ / day for relay fees"),
            ("Allowlist", "USD₮.approve · USD₮.transfer · Textile reactor · cNGN/IDRX.transfer"),
            ("Expiry", "14 days (2026-12-04)"), ("Registered", "Altana Keystore, verifiable by anyone"),
            ("Enforced by", "the wallet's account contract on Celo, not the agent's code")]
    y = 350
    for k, v in rows:
        d.rounded_rectangle((80, y, 1840, y + 80), 14, fill=CARD, outline=LINE, width=2)
        d.text((120, y + 40), k, font=F(32, "SemiBold"), fill=G, anchor="lm"); d.text((480, y + 40), v, font=F(32), fill=FG, anchor="lm"); y += 98
    caption(d, cap); emit(im, secs)

TXS = [("ERC-8004 register (agentId 10076)", "direct", "0x16617527c18632ae4cb5f3d113d341f361338e4c5832cde29c9788c10670c7d1", "tail"),
       ("Approve CELO → Textile reactor", "direct", "0xf970babb365423f9225503de7f491cd1accb94d4bf86de290f8ece8206871dc5", "tail"),
       ("Swap 300 CELO → 17.12 USD₮ (Textile)", "direct", "0x791a936fb2f06dfaba0e1a1f8fb58cccf62eea3ce5f1347a25b2d54aff47de64", "tail"),
       ("EIP-7702 delegation → Altana proxy", "direct", "0x8ac312d5d46fa5b8ae4a6705488106e79f42a4c49719a39a7f6edeb1d310cd85", "tail"),
       ("Altana grantSession (15 USD₮/week)", "relayed", "0x7116b2dd57ea77544fbdb691ae6c2f6e94ec169ea893ad592969928c4c9c92d2", "none (SDK-built)"),
       ("Payout 0.10 USD₮ (relay tag test)", "relayed", "0x51172c5868e446284a324d51633a79c92f3b0342d3bdea64ac39a442a1fca0be", "nested"),
       ("Payout 1.50 USD₮ → 2,161.60 cNGN", "relayed", "0xdce0d203d8a7587170fa9ebb11a38bc261f64be18492c53629341a02a06cb86e", "nested"),
       ("Payout 1.00 USD₮", "relayed", "0xa159d88dfad7b2e1a977fd08a76b0e1fe5c91d70ebc70ac1f0e0436274387452", "nested")]
def tx_slide(cap, secs, path=None):
    im, d = canvas(); header(im, d, "Real Celo mainnet transactions", "On-chain record · 2026-11-20")
    y = 320; d.text((80, y), "Step", font=F(26, "SemiBold"), fill=MUT); d.text((800, y), "Route", font=F(26, "SemiBold"), fill=MUT)
    d.text((960, y), "celoscan.io/tx/…", font=F(26, "SemiBold"), fill=MUT); d.text((1640, y), "Tag", font=F(26, "SemiBold"), fill=MUT); y += 50
    for what, route, h, tag in TXS:
        d.line([(80, y - 8), (1840, y - 8)], fill=LINE, width=2)
        d.text((80, y), what, font=F(28), fill=FG); d.text((800, y), route, font=F(28, "Medium"), fill=Y if route == "direct" else BLUE)
        d.text((960, y + 2), h[:22] + "…" + h[-8:], font=M(26), fill=G)
        d.text((1640, y), ("✓ " if tag in ("tail", "nested") else "✗ ") + tag, font=F(28, "Medium"), fill=G if tag in ("tail", "nested") else R); y += 56
    d.text((80, y + 14), "Over-cap payout of 16 USD₮: refused by the session spend limit, never broadcast.", font=F(30, "SemiBold"), fill=R)
    caption(d, cap); emit(im, secs)
    if path: im.save(path)

def shot_slide(png, cap, secs, title):
    im, d = canvas(); header(im, d, title, "Live dashboard · getrigbase.github.io/rigbase-payout")
    s = Image.open(png).convert("RGB").crop((0, 0, 1600, 700)); s.thumbnail((1760, 670)); im.paste(s, ((W - s.width) // 2, 300))
    d.rectangle([(W - s.width) // 2 - 2, 298, (W + s.width) // 2 + 1, 300 + s.height + 1], outline=LINE, width=2)
    caption(d, cap); emit(im, secs)

def closing(cap, secs):
    im, d = canvas()
    lg = LOGO.resize((220, 220)); im.paste(lg, (W // 2 - 110, 150), lg)
    d.text((W // 2, 430), "RigBase Payout", font=F(80, "Bold"), fill=FG, anchor="mm")
    for i, (k, v) in enumerate([("Code", "github.com/getrigbase/rigbase-payout"), ("Live app", "getrigbase.github.io/rigbase-payout"),
                                ("Agent wallet", "0x22d66bD658ad8b5269998545719941479ef4478d"), ("ERC-8004", "agentId 10076"),
                                ("Tag", "celo_f41eab517821"), ("Contact", "RigBase · hello@getrigbase.com")]):
        d.text((700, 540 + i * 62), k, font=F(34, "SemiBold"), fill=G, anchor="rm"); d.text((740, 540 + i * 62), v, font=M(32), fill=FG, anchor="lm")
    caption(d, cap); emit(im, secs)

# ---------- terminal
HEX = re.compile(r"0x[0-9a-fA-F]{72,}")
def clean(line): return HEX.sub(lambda m: m.group(0)[:20] + "…" + m.group(0)[-36:], line)
def term(cmd, path, cap, secs, title, step=3, dt=0.10, hl=None, maxlines=None, save=None):
    raw = [clean(l.rstrip("\n")) for l in open(path, encoding="utf-8")]
    lines = []
    for l in raw:
        if l.startswith("run log ->"): continue
        ind = len(l) - len(l.lstrip())
        while len(l) > 104:
            cut = l.rfind(" ", ind + 20, 104)
            cut = cut if cut > 0 else 104
            lines.append(l[:cut]); l = " " * (ind + 2) + l[cut:].lstrip()
        lines.append(l)
    if maxlines: lines = lines[:maxlines]
    rows = 20; lh = 35; font = M(28); fb = M(28, True)
    def draw(k, typed):
        im, d = canvas()
        d.text((80, 60), title, font=F(40, "Bold"), fill=FG)
        d.rounded_rectangle((60, 130, W - 60, H - 120), 16, fill=(8, 12, 22), outline=LINE, width=2)
        for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]): d.ellipse([90 + i * 34, 152, 108 + i * 34, 170], fill=c)
        d.text((W // 2, 161), "rigbase-payout — bash", font=F(22), fill=MUT, anchor="mm")
        y0 = 200
        d.text((90, y0), "$ ", font=fb, fill=G); d.text((120, y0), typed, font=fb, fill=FG)
        shown = lines[:k]; vis = shown[-rows:]
        for i, l in enumerate(vis):
            col = FG
            if l.startswith("["): col = Y
            if hl and any(h in l for h in hl): col = R if "reject" in l.lower() or "refus" in l.lower() or "spending limit" in l else G
            d.text((90, y0 + lh * (i + 1) + 8), l, font=font, fill=col)
        caption(d, cap); return im
    # typing
    for j in range(0, len(cmd) + 1, max(1, len(cmd) // 12)): emit(draw(0, cmd[:j]), 0.06)
    emit(draw(0, cmd), 0.4)
    total = len(lines); steps = list(range(step, total + step, step))
    t_reveal = len(steps) * dt
    for k in steps: emit(draw(min(k, total), cmd), dt)
    last = draw(total, cmd); emit(last, max(1.5, secs - t_reveal - 1.2))
    if save: last.save(save)

def build(segs):
    global frames, n
    frames = []; 
    for s in segs: s()
    return frames

def encode(fr, out):
    lst = f"{ROOT}/frames/list.txt"
    with open(lst, "w") as f:
        for p, s in fr: f.write(f"file '{p}'\nduration {s:.3f}\n")
        f.write(f"file '{fr[-1][0]}'\n")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", "fps=30,format=yuv420p",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-tune", "stillimage", "-movflags", "+faststart", out], check=True)

if __name__ == "__main__":
    shutil.rmtree(FR, ignore_errors=True); os.makedirs(FR)
    SS = f"{ROOT}/screenshots"
    full = [
        lambda: title_card("RigBase Payout · Celo \"Agents Open for Business\" · Tracks 4 + 1", 7),
        lambda: slide("Paying contractors abroad is slow — and agents are risky", [
            "RigBase Studio pays freelance contractors in Lagos and Jakarta.",
            "Bank wires: days, $25+ fees, poor FX. Raw USD stablecoins: the contractor still has to off-ramp.",
            "Automating it with an AI agent normally means handing it the treasury key. One bug drains the wallet."],
            "The problem", 12, "Problem"),
        lambda: slide("A payroll agent on a leash", [
            "The studio grants the agent an Altana session key: weekly cap, allowlist, expiry, enforced on-chain.",
            "The agent reads a payroll file, gets a firm Textile FX quote, and pays each contractor in their currency.",
            "One atomic intent per payout: approve USD₮ → Textile swap → transfer cNGN / IDRX to the contractor.",
            "Anything over the cap is refused by the wallet itself."], "The solution", 14, "Solution"),
        lambda: arch("Admin grants a capped session · agent quotes on Textile · pays through the Altana relay", 18, f"{SS}/02-architecture.png"),
        lambda: caps_slide("The spend policy lives in the wallet's account contract, not in the agent", 12),
        lambda: term("npm run pay -- status", f"{CAP}/status.txt", "Real output: live balances, session, ERC-8004 agent and our attribution tag", 14, "1 · Agent status (read-only, Celo mainnet)", hl=["erc8004Agents", "celo_f41eab517821"]),
        lambda: term("npm run pay -- run payroll/demo-full.json", f"{CAP}/dryrun.txt", "Dry run with LIVE Textile prices: 2 USD₮ ≈ 2,876 cNGN or 36,604 IDRX; every call is tagged", 18, "2 · Payroll dry run (live Textile FX quotes)", step=4, hl=["\"buy\""]),
        lambda: term("LIVE=1 npm run pay -- run payroll/demo-week-47.json --live", f"{CAP}/live_payroll.txt", "Replay of the real mainnet run log: firm Textile quote, then two confirmed relayed payouts", 16, "3 · Live payroll on mainnet (2026-11-20)", step=5, hl=["payout.confirmed", "celoscan"]),
        lambda: term("LIVE=1 npm run pay -- run payroll/demo-over-cap.json --live --probe-cap", f"{CAP}/live_overcap.txt", "16 USD₮ is over the 15 USD₮/week cap: the session's on-chain limit refuses it. Never broadcast.", 15, "4 · Over-cap payout is refused", step=3, hl=["payout.rejected", "spending limit", "altana-session-cap"], save=f"{SS}/03-overcap-refused.png"),
        lambda: term("npm run pay -- verify 0x16617527… 0xdce0d203…", f"{CAP}/verify.txt", "Tag check on-chain: direct tx tagged at the tail; relayed payout carries it inside the intent", 14, "5 · Attribution tag verified on-chain", hl=["verdict", "celo_f41eab517821"]),
        lambda: tx_slide("8 real transactions from the agent wallet, all on celoscan.io", 18, f"{SS}/04-mainnet-txs.png"),
        lambda: shot_slide(f"{SS}/01-dashboard.png", "Live read-only app: balances, on-chain caps and tags read in your browser from forno.celo.org", 10, "Try it in the browser"),
        lambda: slide("Built for two Celo tracks", [
            "Track 4 · Altana Agent Wallets: spends only through a capped, allowlisted, expiring session key.",
            "Track 1 · Textile FX Stablecoin Corridors: real one-way USD₮→cNGN payouts (IDRX ready), no wash volume.",
            "ERC-8004 agent #10076 registered from the agent wallet, tagged.",
            "ERC-8021 tag celo_f41eab517821 on every call we build. Pilot: RigBase is the first user."],
            "Tracks, identity and attribution", 13, "Submission", size=36),
        lambda: closing("Open source (MIT) · built by RigBase", 8),
    ]
    encode(build(full), f"{ROOT}/rigbase-payout-demo.mp4")
    shutil.rmtree(FR); os.makedirs(FR)
    short = [
        lambda: title_card("RigBase Payout · Celo mainnet · Tracks 4 + 1", 4),
        lambda: arch("Capped Altana session key + Textile FX quotes → contractors paid in local stablecoins", 10),
        lambda: term("LIVE=1 npm run pay -- run payroll/demo-week-47.json --live", f"{CAP}/live_payroll.txt", "Real mainnet run: USD₮ → cNGN via Textile, paid through the Altana session", 10, "Live payroll on mainnet", step=8, dt=0.06, hl=["payout.confirmed", "celoscan"]),
        lambda: term("LIVE=1 npm run pay -- run payroll/demo-over-cap.json --live --probe-cap", f"{CAP}/live_overcap.txt", "Over the 15 USD₮/week cap → refused by the wallet's on-chain limit", 10, "Over-cap payout is refused", step=6, dt=0.06, hl=["payout.rejected", "spending limit"]),
        lambda: tx_slide("Real Celo mainnet transactions, tagged celo_f41eab517821", 10),
        lambda: shot_slide(f"{SS}/01-dashboard.png", "Live dashboard: getrigbase.github.io/rigbase-payout", 8, "Try it in the browser"),
        lambda: closing("github.com/getrigbase/rigbase-payout", 8),
    ]
    encode(build(short), f"{ROOT}/rigbase-payout-demo-1min.mp4")
    shutil.rmtree(FR)
