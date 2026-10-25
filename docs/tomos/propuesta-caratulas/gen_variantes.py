import math, weasyprint
INT=[("ARIZA, Alena","95359"),("BORDINO BLANCHE, Juan Cruz","95008"),("DALMAGRO, Lucas","94366"),("VERGARA, Tomás Ignacio","94197"),("YORLANO, Pedro","95197")]
SIM='<svg viewBox="0 0 500 500"><rect width="500" height="500" rx="112" fill="#0A0A0B"/><circle cx="250" cy="250" r="182" fill="#fff" fill-opacity=".5"/><circle cx="250" cy="250" r="157" fill="#fff" fill-opacity=".6"/><circle cx="250" cy="250" r="140.9" fill="#fff"/><circle cx="250" cy="250" r="124" fill="#0A0A0B"/></svg>'

def dots(cx,cy,R,step,col,lime_every=0):
    o=[]
    n=int(R/step)+1
    for i in range(-n,n+1):
        for j in range(-n,n+1):
            x=cx+i*step+(step/2 if j%2 else 0); y=cy+j*step*0.866
            d=math.hypot(x-cx,y-cy)
            if d>R: continue
            if d<R*0.42: continue           # hueco central (eclipse)
            t=(d-R*0.42)/(R*0.58)           # 0 borde interno -> 1 externo
            r=step*0.40*(1-t)**0.9+0.25
            c=col
            if lime_every and (i*7+j*3)%lime_every==0 and t<0.6: c="#C6F24A"
            o.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{c}"/>')
    return "".join(o)

def lineas(col,n=26):
    o=[]
    for k in range(n):
        y=40+k*17
        amp=30+k*2.2
        o.append(f'<path d="M0 {y} C 140 {y-amp} 260 {y+amp} 500 {y-amp*0.5}" fill="none" stroke="{col}" stroke-width="{0.9 if k%5 else 1.6}" stroke-opacity="{0.18+0.5*(k/n):.2f}"/>')
    return "".join(o)

ART={
 "gris":{
  "tapa":'<svg class="art" viewBox="0 0 500 500"><circle cx="250" cy="250" r="240" fill="#E6E6E9"/><circle cx="250" cy="250" r="190" fill="#D2D2D7"/><circle cx="250" cy="250" r="140" fill="#B4B4BB"/><circle cx="250" cy="250" r="92" fill="#8A8A93"/><circle cx="250" cy="250" r="50" fill="#0A0A0B"/></svg>',
  "sep":'<svg class="art" viewBox="0 0 500 500"><circle cx="250" cy="250" r="240" fill="#E6E6E9"/><circle cx="250" cy="250" r="190" fill="#D2D2D7"/><circle cx="250" cy="250" r="140" fill="#B4B4BB"/><circle cx="250" cy="250" r="92" fill="#8A8A93"/></svg>'},
 "puntos":{
  "tapa":'<svg class="art" viewBox="0 0 500 500">'+dots(250,250,245,13,"#0A0A0B",9)+'</svg>',
  "sep":'<svg class="art" viewBox="0 0 500 500">'+dots(250,250,245,13,"#0A0A0B",9)+'</svg>'},
 "lineas":{
  "tapa":'<svg class="art" viewBox="0 0 500 500" preserveAspectRatio="none">'+lineas("#0A0A0B")+'<path d="M-10 420 C 120 300 220 400 330 250 S 470 120 520 90" fill="none" stroke="#C6F24A" stroke-width="6" stroke-linecap="round"/><circle cx="330" cy="250" r="9" fill="#0A0A0B"/><circle cx="330" cy="250" r="4" fill="#C6F24A"/></svg>',
  "sep":'<svg class="art" viewBox="0 0 500 500" preserveAspectRatio="none">'+lineas("#0A0A0B",18)+'<path d="M-10 380 C 120 290 220 380 330 250 S 470 150 520 120" fill="none" stroke="#C6F24A" stroke-width="6" stroke-linecap="round"/></svg>'},
}

CSS="""
@page{size:A4;margin:0}
*{box-sizing:border-box}
html{font-family:"Inter",sans-serif;color:#0A0A0B}body{margin:0}
.pg{width:210mm;height:297mm;position:relative;overflow:hidden;break-after:page}
.eyebrow{font:600 6.8pt/1 "Inter";letter-spacing:.16em;text-transform:uppercase}
.mut{color:#8A8A93}
.etq{position:absolute;left:20mm;top:12mm;font:600 6.8pt/1 "Inter";letter-spacing:.12em;text-transform:uppercase;color:#8A8A93}
.marca{position:absolute;left:20mm;top:20mm;display:flex;align-items:center;gap:3.6mm}
.marca svg{width:11mm;height:11mm}.marca span{font:700 21pt/1 "Inter";letter-spacing:-.045em}
.cat{position:absolute;left:52mm;top:23.5mm;color:#8A8A93}
.chip{display:inline-block;background:#C6F24A;color:#0A0A0B;padding:1.6mm 3mm 1.3mm;border-radius:1mm;margin-bottom:7mm}
h1{font:600 40pt/1.02 "Inter";letter-spacing:-.04em;margin:0 0 6mm}
.baj{font-size:11pt;line-height:1.5;max-width:118mm}
.pie{position:absolute;left:20mm;right:20mm;display:grid;grid-template-columns:1.1fr 1fr;gap:12mm;font-size:8.2pt;line-height:1.55}
.pie .eyebrow{display:block;margin-bottom:2.4mm;color:#8A8A93}
.pie table{width:100%;border-collapse:collapse}.pie td{padding:.8mm 0;border-bottom:.4pt solid #D9D9DE}
.pie td.l{text-align:right;font-family:"JetBrains Mono";color:#3A3A40;font-size:7.6pt}
.inst{position:absolute;left:20mm;right:20mm;bottom:14mm;display:flex;justify-content:space-between;align-items:center;font-size:7.2pt;color:#3A3A40;line-height:1.45}
.inst img{height:11mm}
.num{position:absolute;left:20mm;font:600 96pt/1 "Inter";letter-spacing:-.06em}
.ruta{position:absolute;left:20mm;top:20mm}
.sub{font-size:10.5pt;line-height:1.5;max-width:150mm}
h1.s{font-size:30pt;line-height:1.06;margin:0 0 4mm}
.meta{position:absolute;left:20mm;display:flex;gap:10mm;font-size:7.6pt;color:#3A3A40}.meta div{white-space:nowrap}.meta b{display:block;color:#0A0A0B;font-weight:600;font-size:8.4pt}
.idx{position:absolute;left:20mm;right:20mm;font-size:8.4pt}.idx .eyebrow{display:block;margin-bottom:2.4mm;color:#8A8A93}
.idx div{display:flex;padding:1.2mm 0;border-bottom:.4pt solid #D9D9DE}.idx .n{width:11mm;font-family:"JetBrains Mono";font-size:7.4pt;color:#3A3A40}.idx .p{margin-left:auto;font-family:"JetBrains Mono";font-size:7.4pt}
.foot{position:absolute;left:20mm;right:20mm;bottom:12mm;display:flex;justify-content:space-between;font-size:6.8pt;color:#8A8A93;letter-spacing:.09em;text-transform:uppercase}
.art{position:absolute}
/* GRIS: fondo gris claro arriba, discos tonales */
.gris .top{position:absolute;left:0;right:0;top:0;height:190mm;background:#F1F1F3;overflow:hidden}
.gris .tapa .art{right:-60mm;top:-5mm;width:175mm;height:175mm}
.gris .sep .art{right:-70mm;top:-40mm;width:165mm;height:165mm}
.gris .barra{position:absolute;left:0;right:0;height:2.2mm;background:#0A0A0B}
.gris .lime{position:absolute;left:20mm;width:26mm;height:2.4mm;background:#C6F24A}
.gris .num{color:#0A0A0B}
/* PUNTOS: blanco, halftone */
.puntos .tapa .art{right:-70mm;top:-30mm;width:200mm;height:200mm}
.puntos .sep .art{right:-85mm;top:-45mm;width:190mm;height:190mm}
.puntos .num{color:#0A0A0B}.puntos .num::after{content:"";display:block;width:26mm;height:2.4mm;margin-top:5mm;background:#C6F24A}
.puntos .franja{position:absolute;left:0;top:0;bottom:0;width:9mm;background:#0A0A0B}
.puntos .franja::after{content:"";position:absolute;left:0;top:112mm;width:9mm;height:34mm;background:#C6F24A}
/* LINEAS: ink-50, líneas de flujo y ruta lime */
.lineas .pg{background:#F8F8F9}
.lineas .tapa .art{left:0;top:0;width:210mm;height:150mm}
.lineas .sep .art{left:0;top:0;width:210mm;height:115mm}
.lineas .num{color:#0A0A0B}
"""

def tapa(v,tomo,tit,baj):
    ink = "#fff" if False else "#0A0A0B"
    top={"gris":190,"puntos":0,"lineas":0}[v]
    tit_html=f'<h1>{tit}</h1>'
    t={"gris":(150),"puntos":(150),"lineas":(160)}[v]
    parts=[f'<section class="pg tapa {v}">']
    if v=="gris": parts.append('<div class="top"></div>')
    if v=="puntos": parts.append('<div class="franja"></div>')
    parts.append(ART[v]["tapa"])
    parts.append(f'<div class="marca">{SIM}<span>movo</span></div><div class="cat eyebrow">Proyecto Final 2026 · 5K3 · Grupo 27</div>')
    # título
    if v=="gris":
        parts.append(f'<div style="position:absolute;left:20mm;top:120mm;right:30mm"><div class="chip eyebrow">{tomo}</div>{tit_html}<div class="baj" style="color:#3A3A40">{baj}</div></div><div class="barra" style="top:190mm"></div>')
        py=204
    elif v=="puntos":
        parts.append(f'<div style="position:absolute;left:30mm;top:150mm;right:30mm"><div class="chip eyebrow">{tomo}</div>{tit_html}<div class="baj" style="color:#3A3A40">{baj}</div></div>')
        py=222
    else:
        parts.append(f'<div style="position:absolute;left:20mm;top:158mm;right:30mm"><div class="chip eyebrow">{tomo}</div>{tit_html}<div class="baj" style="color:#3A3A40">{baj}</div></div>')
        py=234
    L=30 if v=="puntos" else 20
    rows="".join(f'<tr><td>{a}</td><td class="l">{b}</td></tr>' for a,b in INT)
    parts.append(f'<div class="pie" style="top:{py}mm;left:{L}mm"><div><span class="eyebrow">Integrantes</span><table>{rows}</table></div><div><span class="eyebrow">Equipo docente</span>Profesor Adjunto: Ing. Sergio Quinteros<br>Jefa de Trabajos Prácticos: Ing. Cecilia Trettel<br><br><span class="eyebrow">Entrega</span>Categoría: Producto · Proyecto independiente<br>Córdoba, noviembre de 2026</div></div>')
    parts.append(f'<div class="inst" style="left:{L}mm"><img src="utn-frc-extendido.svg" alt=""><div style="text-align:right">Universidad Tecnológica Nacional · Facultad Regional Córdoba<br>Ingeniería en Sistemas de Información · Cátedra Proyecto Final</div></div></section>')
    return "".join(parts)

def sep(v):
    L=30 if v=="puntos" else 20
    p=[f'<section class="pg sep {v}">']
    if v=="gris": p.append('<div class="top" style="height:150mm"></div>')
    if v=="puntos": p.append('<div class="franja"></div>')
    p.append(ART[v]["sep"])
    p.append(f'<div class="ruta eyebrow mut" style="left:{L}mm">Tomo I · Documentación de Proyecto</div>')
    p.append(f'<div class="num" style="left:{L}mm;top:{ {"gris":52,"puntos":60,"lineas":88}[v]}mm">09</div>')
    ty={"gris":112,"puntos":132,"lineas":118}[v]
    p.append(f'<div style="position:absolute;left:{L}mm;right:40mm;top:{ {"gris":118,"puntos":150,"lineas":130}[v]}mm"><h1 class="s">User Story Mapping y Backlog Inicial</h1><div class="sub" style="color:#3A3A40">Mapa de historias de usuario del producto y backlog estimado en el Sprint 0.</div></div>')
    if v=="gris": p.append('<div class="barra" style="top:150mm"></div>')
    p.append(f'<div class="meta" style="left:{L}mm;top:190mm"><div><b>Versión 1.0</b>vigente</div><div><b>Octubre de 2026</b>última revisión</div></div>')
    p.append(f'<div class="idx" style="left:{L}mm;top:210mm"><span class="eyebrow">Contenido</span><div><span class="n">9.1</span>User Story Map<span class="p">108</span></div><div><span class="n">9.2</span>Backlog Inicial<span class="p">110</span></div><div><span class="n">9.3</span>Backlog detallado por épica<span class="p">112</span></div></div>')
    p.append(f'<div class="foot" style="left:{L}mm"><span>Movo · Proyecto Final 2026</span><span>UTN FRC · ISI · 5K3 · Grupo 27</span></div></section>')
    return "".join(p)

body=""
for v,nom in [("gris","B · Grises"),("puntos","C · Puntos"),("lineas","D · Líneas y ruta")]:
    body+=f'<div class="{v}">'+tapa(v,"Tomo II","Documentación<br>de Producto","Movo: plataforma de logística colaborativa P2P. Historias de usuario y su trazabilidad, modelo de diseño, modelo de datos y arquitectura del sistema.")+sep(v)+'</div>'
html=f'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Variantes</title><style>{CSS}</style></head><body>{body}</body></html>'
open("variantes.html","w").write(html)
weasyprint.HTML("variantes.html").write_pdf("propuesta-variantes.pdf")
import pypdfium2 as p
d=p.PdfDocument("propuesta-variantes.pdf")
for i in range(len(d)): d[i].render(scale=1.0).to_pil().save(f"/tmp/claude-0/-home-user-movo/7a8dd6e6-333a-59ce-bc82-203b9a7fc568/scratchpad/v-{i}.png")
print(len(d))
