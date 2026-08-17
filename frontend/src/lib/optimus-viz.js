/*!
 * optimus-viz — visualizadores de fala e esferas para o AgentOptimus
 * Canvas 2D + WebGL2, sem dependencia. Gerado em 2026-08-15.
 *
 *   OptimusViz.simulate(true);                         // voz simulada
 *   OptimusViz.attachMic();                            // ou microfone real
 *   OptimusViz.attachAnalyser(meuAnalyserNode);        // ou um AnalyserNode existente
 *   OptimusViz.setLevel(0.7);                          // ou so um nivel 0..1
 *   var v = OptimusViz.mount("#orb", "anel", { palette: "roxo" });
 *   v.stop(); v.start(); v.destroy();
 *
 * Aviso: cada visualizador guarda estado proprio em escopo de modulo
 * (rastro, ondas, espectrograma). Montar DUAS instancias do MESMO id
 * na mesma pagina faz as duas compartilharem esse estado.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else root.OptimusViz = factory();
})(typeof self !== "undefined" ? self : this, function () {
"use strict";
var VS_SRC = "#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
var FS_SRC = "#version 300 es\nprecision highp float;\nuniform vec2 R;uniform float T,A,AA,PAL,ROT;\nout vec4 O;\n\nconst float PI=3.14159265;\n\n/* ---------- ruido ---------- */\nfloat hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}\nfloat vnz(vec3 x){\n  vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);\n  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),\n                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),\n             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),\n                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);\n}\nfloat fbm(vec3 p){\n  float s=0.,a=.5;\n  for(int i=0;i<3;i++){s+=a*vnz(p);p=p*2.03+vec3(1.7,9.2,4.3);a*=.5;}\n  return s;\n}\n\nmat2 rot2(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}\n\n/* ---------- forma: domain warping da a organicidade ---------- */\nfloat map(vec3 p){\n  float t=T*.09*ROT;\n  vec3 q=p;\n  q.xz=rot2(t)*q.xz;\n  q.xy=rot2(t*.42)*q.xy;\n  float w=fbm(q*1.02+vec3(0.,T*.05,0.));\n  vec3 qq=q+vec3(w-.5,fract(w*7.13)-.5,fract(w*3.71)-.5)*.58;\n  float d=length(p)-1.0;\n  d-=(fbm(qq*1.02)-.5)*(.36+A*.20);\n  d-=(fbm(qq*3.2)-.5)*.075;\n  return d*.58;\n}\nvec3 calcN(vec3 p){\n  vec2 e=vec2(1.,-1.)*.0012;\n  return normalize(e.xyy*map(p+e.xyy)+e.yyx*map(p+e.yyx)+e.yxy*map(p+e.yxy)+e.xxx*map(p+e.xxx));\n}\nfloat march(vec3 ro,vec3 rd,out bool hit){\n  float t=.1;hit=false;\n  for(int i=0;i<88;i++){\n    vec3 p=ro+rd*t;float d=map(p);\n    if(d<.0009*t){hit=true;break;}\n    t+=d*.82;\n    if(t>7.)break;\n  }\n  return t;\n}\n/* sombra propria: e o que faz as reentrancias existirem */\nfloat softShadow(vec3 ro,vec3 rd){\n  float res=1.,t=.03;\n  for(int i=0;i<22;i++){\n    float d=map(ro+rd*t);\n    res=min(res,13.*d/t);\n    t+=clamp(d,.012,.14);\n    if(res<.004||t>3.2)break;\n  }\n  return clamp(res,0.,1.);\n}\nfloat calcAO(vec3 p,vec3 n){\n  float occ=0.,sca=1.;\n  for(int i=0;i<5;i++){\n    float hh=.014+.13*float(i)/4.;\n    float d=map(p+n*hh);\n    occ+=(hh-d)*sca;sca*=.86;\n  }\n  return clamp(1.-2.4*occ,0.,1.);\n}\n/* espalhamento sob a superficie: luz atravessando as partes finas */\nfloat sss(vec3 p,vec3 n,vec3 l){\n  float acc=0.;\n  for(int i=1;i<=3;i++){\n    float dd=float(i)*.09;\n    acc+=max(0.,dd-map(p+l*dd))/dd;\n  }\n  return clamp(1.-acc*.42,0.,1.);\n}\n/* interferencia de filme fino: a iridescencia de verdade nao e paleta, e fisica */\nvec3 thinFilm(float cosT,float thick){\n  float d=thick*(1.+.4*(1.-cosT));\n  vec3 wl=vec3(612.,551.,465.);\n  vec3 ph=4.*PI*d/wl;\n  return .5+.5*cos(ph+vec3(0.,.5,1.));\n}\nvec3 envLight(vec3 rd){\n  float u=rd.y*.5+.5;\n  vec3 sky=mix(vec3(.05,.06,.13),vec3(.32,.30,.52),pow(u,1.4));\n  sky+=vec3(.34,.18,.42)*pow(max(0.,rd.x*.5+.5),3.)*.5;\n  return sky;\n}\nfloat D_GGX(float NoH,float r){float a=r*r,a2=a*a,d=NoH*NoH*(a2-1.)+1.;return a2/(PI*d*d);}\nfloat V_Smith(float NoV,float NoL,float r){float a=r*r;\n  float gv=NoL*(NoV*(1.-a)+a),gz=NoV*(NoL*(1.-a)+a);return .5/max(gv+gz,1e-5);}\nvec3 F_Schlick(vec3 f0,float u){return f0+(1.-f0)*pow(1.-u,5.);}\nvec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}\n\nvec3 shade(vec2 uv){\n  vec3 ro=vec3(0.,0.,3.15),rd=normalize(vec3(uv*1.02,-1.7));\n  bool hit;float t=march(ro,rd,hit);\n  vec3 col;\n  if(!hit){\n    col=envLight(rd)*.16;\n    col+=vec3(.30,.20,.55)*exp(-length(uv)*2.9)*(.30+A*.30);\n    return col;\n  }\n  vec3 p=ro+rd*t,N=calcN(p),V=-rd;\n  vec3 L1=normalize(vec3(-.62,.74,.55)),L2=normalize(vec3(.80,-.28,.42));\n  float NoV=clamp(dot(N,V),1e-4,1.);\n  float ao=calcAO(p,N);\n  float sh1=softShadow(p+N*.006,L1);\n  float sh2=softShadow(p+N*.006,L2)*.6+.4;\n\n  float rough=.14+.16*vnz(p*7.);\n  vec3 f0=vec3(.055);\n  /* filme fino modulado pela espessura local */\n  float thick=250.+520.*fbm(p*1.9);\n  vec3 irid=thinFilm(NoV,thick);\n  vec3 albedo=mix(vec3(.44,.30,.70),vec3(.42,.72,.86),\n                  clamp(dot(N,normalize(vec3(.1,.9,.4)))*.5+.5,0.,1.));\n  albedo=mix(albedo,albedo*irid*1.55,mix(.35,.85,PAL));\n\n  vec3 lum=vec3(0.);\n  /* luz 1 */\n  {\n    vec3 L=L1,H=normalize(L+V);\n    float NoL=clamp(dot(N,L),0.,1.),NoH=clamp(dot(N,H),0.,1.),VoH=clamp(dot(V,H),0.,1.);\n    vec3 F=F_Schlick(f0,VoH);\n    float spec=D_GGX(NoH,rough)*V_Smith(NoV,NoL,rough);\n    vec3 rad=vec3(1.,.95,1.)*2.5*sh1;\n    lum+=(albedo*(1.-F)/PI+F*spec)*rad*NoL;\n  }\n  /* luz 2, fria, de tras */\n  {\n    vec3 L=L2,H=normalize(L+V);\n    float NoL=clamp(dot(N,L),0.,1.),NoH=clamp(dot(N,H),0.,1.),VoH=clamp(dot(V,H),0.,1.);\n    vec3 F=F_Schlick(f0,VoH);\n    float spec=D_GGX(NoH,rough*1.4)*V_Smith(NoV,NoL,rough*1.4);\n    vec3 rad=vec3(.42,.62,1.05)*1.25*sh2;\n    lum+=(albedo*(1.-F)/PI+F*spec)*rad*NoL;\n  }\n  /* ambiente + reflexo do ambiente */\n  vec3 Renv=envLight(reflect(-V,N));\n  vec3 Fr=F_Schlick(f0,NoV);\n  lum+=albedo*envLight(N)*.55*ao;\n  lum+=Renv*Fr*(1.-rough)*1.5*ao;\n  /* espalhamento: as partes finas acendem por dentro */\n  float s=sss(p,N,L1);\n  lum+=vec3(.85,.42,.78)*pow(1.-s,2.2)*.55;\n  /* borda iridescente */\n  float fres=pow(1.-NoV,3.4);\n  lum+=irid*fres*(1.1+A*.5);\n  /* micro-granulado da superficie, como no render original */\n  lum*=.94+.13*vnz(p*52.);\n  col=lum;\n  /* halo em volta */\n  col+=vec3(.30,.20,.55)*exp(-length(uv)*2.9)*(.22+A*.28);\n  return col;\n}\n\nvoid main(){\n  vec2 base=(gl_FragCoord.xy-.5*R)/min(R.x,R.y);\n  vec3 col;\n  if(AA>.5){\n    vec2 px=1./min(R.x,R.y);\n    col =shade(base+vec2(-.25,-.08)*px);\n    col+=shade(base+vec2( .08,-.25)*px);\n    col+=shade(base+vec2( .25, .08)*px);\n    col+=shade(base+vec2(-.08, .25)*px);\n    col*=.25;\n  } else col=shade(base);\n  /* aberracao cromatica sutil na borda do quadro */\n  float r2=dot(base,base);\n  col.r*=1.+r2*.020;col.b*=1.-r2*.014;\n  col=aces(col*1.15);\n  col=pow(col,vec3(.4545));\n  col*=1.-r2*.24;                                   /* vinheta */\n  col+=(hash(vec3(gl_FragCoord.xy,T))-.5)*.017;     /* grao de filme */\n  O=vec4(col,1.);\n}";


function rnd(a,b){return a+Math.random()*(b-a)}
function gauss(s){var u=1-Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(6.283*Math.random())*s}
function nrm(a){var l=Math.hypot(a[0],a[1],a[2])||1;return [a[0]/l,a[1]/l,a[2]/l]}
function crs(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function udir(){var u=rnd(-1,1),t=rnd(0,6.283),s=Math.sqrt(1-u*u);return [s*Math.cos(t),s*Math.sin(t),u]}

/* ruído de valor */
var PERM=new Uint8Array(512);
(function(){var p=[];for(var i=0;i<256;i++)p[i]=i;
  for(var i2=255;i2>0;i2--){var j=(Math.random()*(i2+1))|0,t=p[i2];p[i2]=p[j];p[j]=t}
  for(var k=0;k<512;k++)PERM[k]=p[k&255]})();
function fade(t){return t*t*t*(t*(t*6-15)+10)}
function h3(i,j,k){return PERM[(i+PERM[(j+PERM[k&255])&255])&255]/255}
function vn(X0,Y0,Z0){
  var X=Math.floor(X0),Y=Math.floor(Y0),Z=Math.floor(Z0);
  var fx=X0-X,fy=Y0-Y,fz=Z0-Z,u=fade(fx),v=fade(fy),w=fade(fz);
  function L(a,b,t){return a+(b-a)*t}
  return L(L(L(h3(X,Y,Z),h3(X+1,Y,Z),u),L(h3(X,Y+1,Z),h3(X+1,Y+1,Z),u),v),
           L(L(h3(X,Y,Z+1),h3(X+1,Y,Z+1),u),L(h3(X,Y+1,Z+1),h3(X+1,Y+1,Z+1),u),v),w)*2-1;
}

var AX=nrm([.18,.94,.28]),U=nrm(crs(AX,[0,0,1])),V=crs(AX,U);
function dir(lat,lon){
  var cl=Math.cos(lat),sl=Math.sin(lat),ca=Math.cos(lon),sa=Math.sin(lon);
  return [cl*(U[0]*ca+V[0]*sa)+sl*AX[0],cl*(U[1]*ca+V[1]*sa)+sl*AX[1],cl*(U[2]*ca+V[2]*sa)+sl*AX[2]];
}

/* ============ geradores ============ */
/* cada um devolve {B:[contas], L:[linhas]}  conta={d,r,br,sz,bd}  linha={p:[dirs],r:[raios],br,w,bd} */
function G_roda(K){
  var B=[],L=[],i,k;
  function bead(d,r,br,sz,bd){B.push({d:d,r:r,br:br,sz:sz,bd:bd})}

  /* --- 1. CUBO: nucleo com estrutura, nao so um brilho --- */
  for(i=0;i<70*K;i++){
    var hd=udir(),hr=rnd(.03,.13);
    bead(hd,hr,.55+Math.random()*.6,1.5+Math.random()*.9,(i*3)%24);
  }
  for(i=0;i<3;i++){                        /* tres arcos curtos amarrando o cubo */
    var la0=gauss(.3),lo0=rnd(0,6.283);
    for(k=0;k<34;k++)bead(dir(la0,lo0+(k/34)*2.1),.145+rnd(-.006,.006),.7*rnd(.5,1),1.3,(i*5)%24);
  }

  /* --- 2. RAIOS retos, o leque que sai do cubo --- */
  var NS=Math.round(18*K);
  for(i=0;i<NS;i++){
    var lon=(i/NS)*6.283+rnd(-.05,.05),lat=gauss(.38);
    var d=dir(lat,lon),hot=Math.random()<.30,r1=rnd(.88,.98);
    for(var r=.16;r<r1;r+=.019+Math.random()*.008){
      var tl=1-Math.pow((r-.16)/(r1-.16),1.5);
      bead(d,r+rnd(-.004,.004),(hot?.95:.30)*(.26+tl*.95),hot?1.65:1.0,(i*7)%24);
    }
  }

  /* --- 3. CASCA INTERNA, depois o VAZIO ANELAR, depois a CASCA EXTERNA --- */
  function shell(r0,r1,n,dens,hotp){
    for(var q=0;q<n;q++){
      var la=gauss(.6),rr=rnd(r0,r1),hot=Math.random()<hotp,m=Math.round(dens*K);
      for(var j=0;j<m;j++){
        if(Math.random()<.24)continue;               /* aro tracejado */
        bead(dir(la+rnd(-.01,.01),(j/m)*6.283),rr+rnd(-.005,.005),
             (hot?.85:.26)*rnd(.5,1),hot?1.4:.95,(q*5)%24);
      }
    }
  }
  shell(.28,.54,Math.round(6*K),80,.18);
  /* 0.56 a 0.72 fica VAZIO de proposito — e o anel escuro do meio-raio */
  shell(.74,.99,Math.round(11*K),120,.22);

  /* --- 4. ARO de contas exatamente no raio 1.0 --- */
  var NR=Math.round(300*K);
  for(i=0;i<NR;i++){
    if(Math.random()<.14)continue;
    bead(dir(rnd(-.035,.035),(i/NR)*6.283),1.0+rnd(-.008,.008),.62*rnd(.5,1),1.25,(i*3)%24);
  }

  /* --- 5. DISCO EQUATORIAL que passa do raio: e o bico da silhueta --- */
  for(var ps=0;ps<4;ps++){
    var dr=1.04+ps*.05,np=Math.round(230*K);
    for(i=0;i<np;i++){
      if(Math.random()<.26)continue;
      bead(dir(rnd(-.028,.028),(i/np)*6.283),dr+rnd(-.008,.008),.5*rnd(.4,1),1.15,(i*3)%24);
    }
  }
  for(i=0;i<Math.round(80*K);i++){                   /* dentes do disco */
    var lo2=(i/Math.round(80*K))*6.283,dd=dir(rnd(-.02,.02),lo2),to=rnd(1.14,1.36);
    for(var rt=1.06;rt<to;rt+=.02)bead(dd,rt,.46*rnd(.3,1),1.05,(i*11)%24);
  }

  /* --- 6. ARO SOLTO, flutuando destacado do corpo --- */
  var NA=Math.round(260*K);
  for(i=0;i<NA;i++){
    if(Math.random()<.42)continue;                   /* bem tracejado */
    bead(dir(rnd(-.05,.05)+.10,(i/NA)*6.283),1.46+rnd(-.012,.012),.42*rnd(.4,1),1.1,(i*7)%24);
  }

  /* --- 7. FAIXA LARGA em C: a fita lisa que domina o centro do frame --- */
  for(i=0;i<3;i++){
    var n2=nrm([rnd(-.4,.4),1+rnd(-.3,.3),rnd(-.4,.4)]);
    var u2=nrm(crs(n2,Math.abs(n2[2])<.9?[0,0,1]:[1,0,0])),v2=crs(n2,u2);
    var a0=rnd(0,6.283),ext=rnd(1.9,2.7),rad=rnd(.55,.86);
    var p=[],rr2=[];
    for(k=0;k<=46;k++){
      var a=a0+ext*(k/46);
      p.push([u2[0]*Math.cos(a)+v2[0]*Math.sin(a),u2[1]*Math.cos(a)+v2[1]*Math.sin(a),u2[2]*Math.cos(a)+v2[2]*Math.sin(a)]);
      rr2.push(rad);
    }
    L.push({p:p,r:rr2,br:i===0?1.25:.55,w:i===0?9:5.5,bd:(i*7)%24});
    L.push({p:p,r:rr2.map(function(x){return x+.012}),br:i===0?.9:.4,w:1.2,bd:(i*7)%24});
  }

  /* --- 8. PLACAS retangulares com listras --- */
  for(i=0;i<Math.round(22*K);i++){
    var pd=nrm(udir()),t1=nrm(crs(pd,Math.abs(pd[2])<.9?[0,0,1]:[1,0,0])),t2=crs(pd,t1);
    var pr=rnd(.5,1.0),pw=rnd(.04,.13),ph=rnd(.025,.075);
    for(var gx=-1;gx<=1;gx+=.5){
      for(var gy=-1;gy<=1;gy+=.34){
        bead(nrm([pd[0]+t1[0]*pw*gx+t2[0]*ph*gy,pd[1]+t1[1]*pw*gx+t2[1]*ph*gy,pd[2]+t1[2]*pw*gx+t2[2]*ph*gy]),
             pr,.30*rnd(.4,1),1.0,(i*13)%24);
      }
    }
  }

  /* --- 9. TRILHAS de circuito na casca externa --- */
  for(i=0;i<Math.round(130*K);i++){
    var la3=Math.asin(rnd(-1,1)),lo3=rnd(0,6.283),rc=rnd(.80,1.0),cl=la3,cn=lo3;
    var segs=2+((Math.random()*3)|0);
    for(var sg=0;sg<segs;sg++){
      var hz=sg%2===0,len=rnd(.04,.13);
      for(var q2=0;q2<len;q2+=.016){
        if(hz)cn+=.016/Math.max(.25,Math.cos(cl));else cl+=.016;
        bead(dir(cl,cn),rc,.34*rnd(.3,1),.95,(i*17)%24);
      }
    }
  }

  /* --- 10. FRANJA do perimetro e NEVOA --- */
  for(i=0;i<Math.round(340*K);i++){
    var fd=udir(),s0=rnd(.95,1.01);
    for(var rs=s0;rs<s0+rnd(.02,.11);rs+=.017)bead(fd,rs,.42*rnd(.25,1),.9,(i*13)%24);
  }
  for(i=0;i<Math.round(800*K);i++)
    bead(udir(),rnd(.2,1.06),.13*Math.pow(Math.random(),2.4),.8,(i*5)%24);

  return {B:B,L:L};
}
function G_cidade(K){
  var B=[],L=[],i;
  for(i=0;i<Math.round(420*K);i++){
    var la=Math.asin(rnd(-1,1)),lo=rnd(0,6.283),rc=rnd(.94,1.0),cl=la,cn=lo;
    var segs=2+((Math.random()*4)|0),hot=Math.random()<.14;
    for(var sg=0;sg<segs;sg++){
      var hz=sg%2===0,len=rnd(.05,.2);
      for(var q=0;q<len;q+=.016){
        if(hz)cn+=.016/Math.max(.25,Math.cos(cl));else cl+=.016;
        B.push({d:dir(cl,cn),r:rc,br:(hot?.85:.34)*rnd(.5,1),sz:hot?1.4:1.0,bd:(i*17)%24});
      }
    }
  }
  for(i=0;i<Math.round(140*K);i++){
    var la2=Math.asin(rnd(-1,1)),lo2=rnd(0,6.283),d3=dir(la2,lo2);
    for(var rt=1.0;rt<rnd(1.03,1.16);rt+=.02)B.push({d:d3,r:rt,br:.62*rnd(.3,1),sz:1.1,bd:(i*11)%24});
  }
  for(i=0;i<Math.round(700*K);i++)B.push({d:udir(),r:rnd(.9,1.02),br:.2*Math.pow(Math.random(),2),sz:.8,bd:(i*5)%24});
  return {B:B,L:L};
}
function G_malha(K){
  var B=[],L=[],i,k;
  var NLAT=Math.round(16*K),NLON=Math.round(26*K);
  for(k=1;k<NLAT;k++){
    var la=-1.5708+k*(3.1416/NLAT),p=[],r=[];
    for(i=0;i<=64;i++){var lo=(i/64)*6.283;p.push(dir(la,lo));
      r.push(.94+vn(Math.cos(la)*Math.cos(lo)*2.1,Math.cos(la)*Math.sin(lo)*2.1,Math.sin(la)*2.1)*.16)}
    L.push({p:p,r:r,br:.30+Math.random()*.16,w:.75,bd:(k*5)%24});
  }
  for(k=0;k<NLON;k++){
    var lo2=(k/NLON)*6.283,p2=[],r2=[];
    for(i=0;i<=44;i++){var la2=-1.5708+(i/44)*3.1416;p2.push(dir(la2,lo2));
      r2.push(.94+vn(Math.cos(la2)*Math.cos(lo2)*2.1,Math.cos(la2)*Math.sin(lo2)*2.1,Math.sin(la2)*2.1)*.16)}
    L.push({p:p2,r:r2,br:.30+Math.random()*.16,w:.75,bd:(k*7)%24});
  }
  for(i=0;i<Math.round(500*K);i++)B.push({d:udir(),r:rnd(.9,1.12),br:.22*Math.pow(Math.random(),2),sz:.9,bd:(i*5)%24});
  return {B:B,L:L};
}
function G_isolinhas(K){
  var B=[],L=[],i,k;
  var NL=Math.round(26*K);
  for(k=0;k<NL;k++){
    var lvl=-.85+ (k/NL)*1.7, seeds=3;
    for(var s=0;s<seeds;s++){
      var la=Math.asin(rnd(-1,1)),lo=rnd(0,6.283),p=[],r=[];
      var cl=la,cn=lo;
      for(i=0;i<70;i++){
        var d=dir(cl,cn);
        var g=[vn(d[0]*2.2+lvl*7,d[1]*2.2,d[2]*2.2),vn(d[1]*2.2+31,d[2]*2.2,d[0]*2.2),vn(d[2]*2.2+63,d[0]*2.2,d[1]*2.2)];
        var t=crs(d,g),ln=Math.hypot(t[0],t[1],t[2])||1;
        var nd=nrm([d[0]+t[0]/ln*.055,d[1]+t[1]/ln*.055,d[2]+t[2]/ln*.055]);
        cl=Math.asin(Math.max(-1,Math.min(1,nd[0]*AX[0]+nd[1]*AX[1]+nd[2]*AX[2])));
        cn=Math.atan2(nd[0]*V[0]+nd[1]*V[1]+nd[2]*V[2], nd[0]*U[0]+nd[1]*U[1]+nd[2]*U[2]);
        p.push(nd);r.push(.9+lvl*.13);
      }
      var hot=Math.random()<.10;
      L.push({p:p,r:r,br:hot?1.0:.16,w:hot?2.2:.7,bd:(k*5)%24});
    }
  }
  for(i=0;i<Math.round(700*K);i++)B.push({d:udir(),r:rnd(.85,1.06),br:.16*Math.pow(Math.random(),2.4),sz:.8,bd:(i*5)%24});
  return {B:B,L:L};
}
function G_fluxo(K){
  var B=[],L=[],i,k;
  for(i=0;i<Math.round(60*K);i++){
    var cur=udir(),f=.3+Math.random()*.2,off=Math.random()*90;
    var shell=.62+(vn(cur[0]*1.3,cur[1]*1.3,cur[2]*1.3)*.5+.5)*.42;
    var hot=Math.pow(Math.random(),6.5),p=[],r=[];
    for(k=0;k<150;k++){
      var n=nrm(cur);
      var v=[vn(n[0]*f+off,n[1]*f,n[2]*f),vn(n[1]*f+31,n[2]*f+17,n[0]*f+5),vn(n[2]*f+63,n[0]*f+41,n[1]*f+9)];
      var t=crs(n,v),ln=Math.hypot(t[0],t[1],t[2])||1;
      cur=nrm([n[0]+t[0]/ln*.042,n[1]+t[1]/ln*.042,n[2]+t[2]/ln*.042]);
      p.push(cur.slice());r.push(shell);
    }
    L.push({p:p,r:r,br:.05+hot*1.5,w:.4+hot*3.4,bd:(i*7)%24});
  }
  for(i=0;i<Math.round(1100*K);i++)B.push({d:udir(),r:rnd(.35,1.05),br:.14*Math.pow(Math.random(),3),sz:.8,bd:(i*5)%24});
  return {B:B,L:L};
}
function G_plasma(K){
  var B=[],L=[],i,k;
  for(i=0;i<Math.round(34*K);i++){
    var end=udir(),p=[],r=[],hot=Math.random()<.3;
    var jit=[],prev=[0,0,0];
    for(k=0;k<=40;k++){
      var t=k/40;
      var d=nrm([end[0]*t+gauss(.10)*(1-Math.abs(t-.5)*1.4),
                 end[1]*t+gauss(.10)*(1-Math.abs(t-.5)*1.4),
                 end[2]*t+gauss(.10)*(1-Math.abs(t-.5)*1.4)+.0001]);
      p.push(d);r.push(.06+t*.96);
    }
    L.push({p:p,r:r,br:(hot?1.25:.4),w:hot?2.6:1.0,bd:(i*7)%24});
    for(k=0;k<3;k++){
      var br0=(18+(Math.random()*18)|0),bp=[],brr=[];
      var bd0=p[br0],be=nrm([bd0[0]+gauss(.5),bd0[1]+gauss(.5),bd0[2]+gauss(.5)]);
      for(var q=0;q<=14;q++){var tt=q/14;
        bp.push(nrm([bd0[0]*(1-tt)+be[0]*tt+gauss(.03),bd0[1]*(1-tt)+be[1]*tt+gauss(.03),bd0[2]*(1-tt)+be[2]*tt+gauss(.03)]));
        brr.push(r[br0]*(1-tt)+1.0*tt)}
      L.push({p:bp,r:brr,br:.3,w:.7,bd:(i*11)%24});
    }
  }
  for(i=0;i<Math.round(900*K);i++)B.push({d:udir(),r:rnd(.2,1.04),br:.16*Math.pow(Math.random(),2.6),sz:.85,bd:(i*5)%24});
  return {B:B,L:L};
}


function G_cristal(K){
  var B=[],L=[],i,j,P=[],N=Math.round(150*K);
  for(i=0;i<N;i++)P.push(udir());
  for(i=0;i<N;i++){
    var best=[],bd2=[];
    for(j=0;j<N;j++){ if(i===j)continue;
      var dd=(P[i][0]-P[j][0])*(P[i][0]-P[j][0])+(P[i][1]-P[j][1])*(P[i][1]-P[j][1])+(P[i][2]-P[j][2])*(P[i][2]-P[j][2]);
      if(best.length<3){best.push(j);bd2.push(dd)}
      else{var m=0;for(var q=1;q<3;q++)if(bd2[q]>bd2[m])m=q; if(dd<bd2[m]){best[m]=j;bd2[m]=dd}}
    }
    var hot=Math.random()<.12;
    for(var b=0;b<best.length;b++)
      L.push({p:[P[i],P[best[b]]],r:[.97,.97],br:hot?.9:.20,w:hot?2.0:.7,bd:(i*7)%24});
    B.push({d:P[i],r:.97,br:.55,sz:1.3,bd:(i*5)%24});
  }
  for(i=0;i<Math.round(700*K);i++)B.push({d:udir(),r:rnd(.5,1.0),br:.13*Math.pow(Math.random(),2.4),sz:.8,bd:(i*3)%24});
  return {B:B,L:L};
}
function G_vortice(K){
  var B=[],L=[],i,k,NA=Math.round(9*K);
  for(i=0;i<NA;i++){
    var base=(i/NA)*6.283,hot=Math.random()<.3,p=[],r=[];
    for(k=0;k<=110;k++){
      var t=k/110,la=-1.45+t*2.9,lo=base+t*7.4;
      p.push(dir(la,lo));r.push(.96+Math.sin(t*3.14)*.06);
    }
    L.push({p:p,r:r,br:hot?1.15:.32,w:hot?2.6:.9,bd:(i*7)%24});
    for(k=0;k<=110;k+=3){
      var t2=k/110,lo2=base+t2*7.4;
      B.push({d:dir(-1.45+t2*2.9,lo2),r:.96,br:(hot?.75:.3)*rnd(.4,1),sz:hot?1.4:1.0,bd:(i*5)%24});
    }
  }
  for(i=0;i<Math.round(900*K);i++)B.push({d:udir(),r:rnd(.4,1.04),br:.15*Math.pow(Math.random(),2.6),sz:.85,bd:(i*3)%24});
  return {B:B,L:L};
}
function G_aneis(K){
  var B=[],L=[],i,k,NR2=Math.round(14*K);
  for(i=0;i<NR2;i++){
    var n2=nrm(udir()),u2=nrm(crs(n2,Math.abs(n2[2])<.9?[0,0,1]:[1,0,0])),v2=crs(n2,u2);
    var rad=rnd(.55,1.10),hot=Math.random()<.24,p=[],r=[];
    for(k=0;k<=120;k++){
      var a=(k/120)*6.283;
      p.push([u2[0]*Math.cos(a)+v2[0]*Math.sin(a),u2[1]*Math.cos(a)+v2[1]*Math.sin(a),u2[2]*Math.cos(a)+v2[2]*Math.sin(a)]);
      r.push(rad);
    }
    L.push({p:p,r:r,br:hot?1.1:.26,w:hot?2.4:.8,bd:(i*7)%24});
    for(k=0;k<120;k+=4)B.push({d:p[k],r:rad,br:(hot?.7:.26)*rnd(.4,1),sz:hot?1.3:.95,bd:(i*5)%24});
  }
  for(i=0;i<Math.round(650*K);i++)B.push({d:udir(),r:rnd(.3,1.12),br:.13*Math.pow(Math.random(),2.6),sz:.8,bd:(i*3)%24});
  return {B:B,L:L};
}
function G_enxame(K){
  var B=[],L=[],i,k,NP=Math.round(420*K);
  for(i=0;i<NP;i++){
    var cur=udir(),f=.55,off=Math.random()*90,p=[],r=[];
    var sh=rnd(.62,1.04),hot=Math.random()<.07;
    for(k=0;k<9;k++){
      var n=nrm(cur);
      var vv=[vn(n[0]*f+off,n[1]*f,n[2]*f),vn(n[1]*f+31,n[2]*f+17,n[0]*f+5),vn(n[2]*f+63,n[0]*f+41,n[1]*f+9)];
      var t=crs(n,vv),ln=Math.hypot(t[0],t[1],t[2])||1;
      cur=nrm([n[0]+t[0]/ln*.05,n[1]+t[1]/ln*.05,n[2]+t[2]/ln*.05]);
      p.push(cur.slice());r.push(sh);
    }
    L.push({p:p,r:r,br:hot?1.0:.30,w:hot?2.0:.85,bd:(i*7)%24});
    B.push({d:p[p.length-1],r:sh,br:hot?.9:.4,sz:hot?1.5:1.0,bd:(i*5)%24});
  }
  return {B:B,L:L};
}
function G_fio(K){
  var B=[],L=[],cur=udir(),f=.42,off=Math.random()*90;
  var TOT=Math.round(2600*K),CH=130;
  for(var s=0;s<TOT/CH;s++){
    var p=[],r=[];
    for(var k=0;k<CH;k++){
      var n=nrm(cur);
      var vv=[vn(n[0]*f+off,n[1]*f,n[2]*f),vn(n[1]*f+31,n[2]*f+17,n[0]*f+5),vn(n[2]*f+63,n[0]*f+41,n[1]*f+9)];
      var t=crs(n,vv),ln=Math.hypot(t[0],t[1],t[2])||1;
      cur=nrm([n[0]+t[0]/ln*.030,n[1]+t[1]/ln*.030,n[2]+t[2]/ln*.030]);
      p.push(cur.slice());r.push(.97+vn(cur[0]*2.2,cur[1]*2.2,cur[2]*2.2)*.05);
    }
    L.push({p:p,r:r,br:.34,w:.85,bd:(s*7)%24});
  }
  for(var i=0;i<Math.round(500*K);i++)B.push({d:udir(),r:rnd(.85,1.04),br:.12*Math.pow(Math.random(),2.6),sz:.8,bd:(i*3)%24});
  return {B:B,L:L};
}

var CATALOG=[
  {id:"anth",n:"Anthropic",type:"viz",draw:vAnth,d:"O catavento do Claude, gerado por curva polar em vez de path fixo: 11 petalas de comprimento e largura desiguais, cada uma respirando no seu ritmo e crescendo na sua banda de frequencia. Creme e terracota da marca, sem contorno, com sombra macia dando o volume de ameba."},
  {id:"po",n:"Po",type:"viz",draw:vPo,d:"16 mil pontos brancos crus sobre preto, sem brilho, sem bloom e sem cor. A latitude e sorteada uniforme em vez de por area, o que agrupa nos polos e cria as duas calotas claras. Cada grupo de pontos infla na sua propria banda, e cada silaba dispara um aro de pontos levantados que atravessa a esfera de um lado ao outro."},
  {id:"blob",n:"Blob",type:"gl",d:"Raymarching de um SDF com PBR completo: sombra propria, oclusao, espalhamento sob a superficie e iridescencia por interferencia de filme fino. E a unica que tem luz de verdade."},
  {id:"orbeanel",n:"Orbe com anel",type:"viz",draw:cOrbeAnel,d:"Interior liquido com quatro nebulosas e 26 voltas quase circulares inclinadas formando o anel volumetrico. Halo azul sangrando muito alem do corpo."},
  {id:"circulo",n:"Circulo",type:"viz",draw:cCirculo,d:"Fio de 1px com um realce macio percorrendo ele, e dois trechos onde a luz espalha para dentro em 260 tracos finos. Frio, sem fogo e sem faisca: a fala so alarga e acende o espalhamento."},
  {id:"tunel",n:"Tunel",type:"viz",draw:cTunel,d:"64 aneis recuando em perspectiva com deformacao por ruido e tracos radiais dando a leitura de velocidade."},
  {id:"planeta",n:"Planeta",type:"viz",draw:cPlaneta,d:"Esfera com faixas por ruido, iluminada de um lado so, terminador definido e aro de atmosfera aceso. Estrelas cintilando atras."},
  {id:"portal",n:"Portal",type:"viz",draw:cPortal,d:"Anel de luz com o interior revolvendo e particulas espiralando para dentro, com a escuridao fechando em volta."},
  {id:"maquina",n:"Maquina",type:"viz",draw:cMaquina,d:"Seis aros giroscopicos em eixos proprios girando em sentidos diferentes em torno de um nucleo quente."},

  {id:"siri",n:"Siri Orb",type:"dom",d:"Sete gradientes conicos girando em velocidades e sentidos diferentes, borrados ate virar nevoa. Sem contorno. A voz fecha o foco: quanto mais fala, menos borrado e mais definida a massa por dentro."},
  {id:"orbe",n:"Orbe",type:"orb",pal:"roxo",d:"Esfera preta com roxo por dentro. A borda so existe enquanto ha fala: em silencio ela some por completo."},
  {id:"neural",n:"Neural",type:"viz",draw:vNeural,d:"Rede de quatro camadas. As bandas de voz entram na primeira, propagam por pesos reais e acendem os nos. Os pontos correndo nas arestas sao o sinal."},
  {id:"anel",n:"Anel",type:"viz",draw:vAnel,d:"28 bandas em escala log ligadas por uma curva fechada, com o anel de pico segurando 500ms antes de cair por gravidade. O grave respira o raio inteiro."},
  {id:"rastro",n:"Rastro",type:"viz",draw:vRastro,d:"O frame anterior volta girado e levemente encolhido, entao o rastro acompanha a rotacao em arco em vez de esguichar pra fora."},
  {id:"mandala",n:"Mandala",type:"viz",draw:vMandala,d:"Sete camadas de arcos com simetria de seis, girando em sentidos alternados. Geometria burra e brilho caro, a receita do Audiograph."},
  {id:"barras",n:"Barras",type:"viz",draw:vBarras,d:"Espectro em barras espelhadas, com a crista marcada. Le a frequencia da esquerda pra direita."},
  {id:"onda",n:"Onda",type:"viz",draw:vOnda,d:"Osciloscopio: tres tracos sobrepostos somando doze harmonicos. O da frente e a voz, os de tras sao o eco."},
  {id:"batimento",n:"Batimento",type:"viz",draw:vBatimento,d:"Eletrocardiograma. Cada silaba detectada dispara um pico; o resto e o ruido de base rolando."},
  {id:"pulso",n:"Pulso",type:"viz",draw:vPulso,d:"Um anel nasce a cada ataque de silaba e se expande ate sumir. Silencio significa nenhum anel novo."},
  {id:"espectro",n:"Espectro",type:"viz",draw:vEspectro,d:"Espectrograma rolando: o tempo corre pra direita, a frequencia sobe. Da pra ver a frase inteira desenhada."},
  {id:"roda",n:"Roda",g:G_roda,d:"Refeita quadro a quadro: cubo com estrutura, 18 raios retos, casca interna e externa separadas por um vazio anelar, aro de contas, disco equatorial com dentes passando do raio, aro solto flutuando fora do corpo, a faixa larga em C e placas com listras."},
  {id:"cidade",n:"Cidade",g:G_cidade,d:"Trilhas ortogonais de circuito enroladas na casca. E o que mais lembra a textura do frame."},
  {id:"aneis",n:"Aneis",g:G_aneis,d:"Orbitas concentricas em inclinacoes aleatorias. Limpo e mecanico."},
  {id:"vortice",n:"Vortice",g:G_vortice,d:"Bracos espiralando de polo a polo. Le como galaxia enrolada numa bola."},
  {id:"fio",n:"Fio",g:G_fio,d:"Um arame so, continuo, enrolado milhares de vezes."},
  {id:"malha",n:"Malha",type:"viz",draw:vMalha,d:"Grade de paralelos e meridianos com o deslocamento recalculado a cada quadro: ruido andando no tempo, um bico por banda em cada vertice e uma onda de choque atravessando a esfera a cada silaba. Os cruzamentos que mais esticam acendem."}
];

/* ---------- estado de audio (dirigido pela API publica) ---------- */
var BANDS = new Float32Array(24);
var PAL = "azul", PALO = null;
function COL(a, h) {
  if (a <= 0) return "rgba(0,0,0,0)";
  var p = PALO || PAL;
  if (p === "ouro") return "rgba(255," + ((132 + h * 118) | 0) + "," + ((18 + h * 170) | 0) + "," + a + ")";
  if (p === "roxo") return "rgba(" + ((104 + h * 136) | 0) + "," + ((30 + h * 150) | 0) + "," + ((198 + h * 57) | 0) + "," + a + ")";
  return "rgba(" + ((56 + h * 190) | 0) + "," + ((124 + h * 126) | 0) + ",255," + a + ")";
}
function BG() { var p = PALO || PAL; return p === "ouro" ? "#0d0904" : (p === "roxo" ? "#0a0512" : "#060a12"); }

/* voz simulada: silabas com ataque, queda e pausa */
var SIM = false, SYL = { t0: 0, dur: 220, amp: .7, f0: .4, gap: false };
function simBands(t) {
  if (t > SYL.t0 + SYL.dur) {
    SYL.t0 = t;
    SYL.gap = (!SYL.gap) && Math.random() < .34;
    SYL.dur = SYL.gap ? (110 + Math.random() * 300) : (120 + Math.random() * 230);
    SYL.amp = SYL.gap ? 0 : (.38 + Math.random() * .62);
    SYL.f0 = Math.random();
  }
  var p = (t - SYL.t0) / SYL.dur;
  var env = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
  var center = SYL.f0 * 17 + 2, s = 0;
  for (var b = 0; b < 24; b++) {
    var d = (b - center) / 5.5;
    var v = SYL.amp * env * Math.exp(-d * d) * (.62 + .38 * Math.sin(t * .019 + b * .8));
    v += SYL.amp * env * .30 * Math.exp(-b * .32);
    v = Math.min(1, v);
    BANDS[b] += (v - BANDS[b]) * .34;
    s += BANDS[b];
  }
  return s / 24;
}
var _analyser = null, _freq = null;
function readLevel(t) {
  var b, s = 0;
  if (_analyser) {
    _analyser.getByteFrequencyData(_freq);
    for (b = 0; b < 24; b++) {
      var i0 = ((b * b) * .62 + b * 2) | 0, i1 = Math.min(_freq.length - 1, i0 + 5), a = 0, n = 0;
      for (var i = i0; i <= i1; i++) { a += _freq[i]; n++; }
      BANDS[b] += ((n ? a / n / 255 : 0) - BANDS[b]) * .3;
      s += BANDS[b];
    }
    return s / 24;
  }
  if (SIM) return simBands(t);
  for (b = 0; b < 24; b++) s += BANDS[b];
  return s / 24;
}

/* ============ render ============ */
function render(ctx,w,h,S,t,E,scale){
  ctx.globalCompositeOperation="source-over";
  var g0=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.7);
  g0.addColorStop(0,BG());g0.addColorStop(1,"#03050a");
  ctx.fillStyle=g0;ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,R=Math.min(w,h)*.30*(1+E*.09);
  var yaw=t*.00011,pit=Math.sin(t*.00007)*.34;
  var cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pit),sp=Math.sin(pit);
  function P(dx,dy,dz,r){
    var px=dx*r,py=dy*r,pz=dz*r;
    var x1=px*cy-pz*sy,z1=px*sy+pz*cy;
    var y1=py*cp-z1*sp,z2=py*sp+z1*cp;
    var sc=1/(3.0-z2*.9);
    return [CX+x1*R*2.6*sc,CY+y1*R*2.6*sc,z2,sc];
  }
  ctx.globalCompositeOperation="lighter";
  ctx.lineCap="round";ctx.lineJoin="round";

  for(var li=0;li<S.L.length;li++){
    var Ln=S.L[li],bd=BANDS[Ln.bd],N=Ln.p.length,ds=0;
    ctx.beginPath();
    for(var k=0;k<N;k++){
      var q=P(Ln.p[k][0],Ln.p[k][1],Ln.p[k][2],Ln.r[k]*(1+bd*.1));
      k?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);ds+=(q[2]+1)/2;
    }
    var dp=ds/N,al=Ln.br*(.05+dp*dp*.8)*(.45+bd*1.4);
    ctx.strokeStyle=COL(Math.min(.97,al),dp*.4+bd*.6+(Ln.br>.9?.35:0));
    ctx.lineWidth=Ln.w*scale*(.35+dp*.95)*(1+bd*.5);
    ctx.stroke();
  }
  for(var i=0;i<S.B.length;i++){
    var B=S.B[i],b2=BANDS[B.bd],q2=P(B.d[0],B.d[1],B.d[2],B.r*(1+b2*.1));
    var dep=(q2[2]+1)/2,al2=B.br*(.10+dep*dep*1.0)*(.55+b2*1.4);
    if(al2<.014)continue;
    ctx.fillStyle=COL(Math.min(.95,al2),dep*.42+b2*.55+(B.br>.7?.25:0));
    var s=B.sz*q2[3]*1.5*scale*(1+b2*.3);
    ctx.fillRect(q2[0],q2[1],s,s);
  }
  var hx=CX-R*.05,hy=CY+R*.02,hr=R*(.16+E*.13);
  var hg=ctx.createRadialGradient(hx,hy,0,hx,hy,hr*3.3);
  hg.addColorStop(0,"rgba(255,255,255,"+(.68+E*.28)+")");
  hg.addColorStop(.08,"rgba(240,240,255,.62)");
  hg.addColorStop(.3,COL(.24+E*.2,1));hg.addColorStop(1,COL(0,1));
  ctx.fillStyle=hg;ctx.beginPath();ctx.arc(hx,hy,hr*3.3,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}


function renderOrb(ctx,w,h,t,E){
  var CX=w/2,CY=h/2,R=Math.min(w,h)*.30;
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="#050308";ctx.fillRect(0,0,w,h);
  var N=180,pts=[];
  for(var i=0;i<N;i++){
    var a=(i/N)*6.283;
    var b1=BANDS[(i*3)%24],b2=BANDS[(i*7)%24];
    var wob=vn(Math.cos(a)*1.7+t*.00022,Math.sin(a)*1.7,t*.00013)*.055
           +vn(Math.cos(a)*3.4,Math.sin(a)*3.4,t*.00031)*.028;
    var r=R*(1+wob+(b1*.16+b2*.10)*(.6+.4*Math.sin(a*3+t*.001))+E*.05);
    pts.push([CX+Math.cos(a)*r,CY+Math.sin(a)*r]);
  }
  function path(){
    ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
    for(var k=1;k<N;k++){var p0=pts[k-1],p1=pts[k];
      ctx.quadraticCurveTo(p0[0],p0[1],(p0[0]+p1[0])/2,(p0[1]+p1[1])/2)}
    ctx.closePath();
  }
  path();
  var g=ctx.createRadialGradient(CX-R*.16,CY-R*.20,R*.05,CX,CY,R*1.05);
  g.addColorStop(0,"rgba(96,26,168,"+(.55+E*.35)+")");
  g.addColorStop(.35,"rgba(46,12,86,.92)");
  g.addColorStop(.78,"rgba(12,4,24,1)");
  g.addColorStop(1,"rgba(4,2,10,1)");
  ctx.fillStyle=g;ctx.fill();
  ctx.save();ctx.clip();
  ctx.globalCompositeOperation="lighter";
  for(var n=0;n<5;n++){
    var ph=t*.00018+n*1.7;
    var bx=CX+Math.cos(ph*1.3+n)*R*.34,by=CY+Math.sin(ph*1.7+n*2)*R*.30;
    var br=R*(.30+.12*Math.sin(ph*2+n))*(1+E*.4);
    var bg2=ctx.createRadialGradient(bx,by,0,bx,by,br);
    var inten=(.12+BANDS[(n*5)%24]*.30);
    bg2.addColorStop(0,"rgba("+(150+n*14)+",60,"+(230-n*8)+","+inten+")");
    bg2.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=bg2;ctx.beginPath();ctx.arc(bx,by,br,0,6.283);ctx.fill();
  }
  ctx.restore();
  ctx.globalCompositeOperation="lighter";
  if(E>0.055){
    path();
    ctx.strokeStyle="rgba(200,132,255,"+Math.min(.9,(E-0.055)*1.9)+")";
    ctx.lineWidth=(E-0.055)*5.2;ctx.stroke();
  }
  var sg=ctx.createRadialGradient(CX-R*.30,CY-R*.36,0,CX-R*.30,CY-R*.36,R*.62);
  sg.addColorStop(0,"rgba(228,196,255,"+(.20+E*.16)+")");sg.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=sg;ctx.beginPath();ctx.arc(CX-R*.30,CY-R*.36,R*.62,0,6.283);ctx.fill();
  var og=ctx.createRadialGradient(CX,CY,R*.9,CX,CY,R*2.1);
  og.addColorStop(0,"rgba(112,40,190,"+(.20+E*.22)+")");og.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=og;ctx.beginPath();ctx.arc(CX,CY,R*2.1,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}


/* ---- ataque de silaba: usado por pulso e batimento ---- */
var PREVE=0,ONSET=0,ONSETT=-9999;
function feelOnset(t,E){
  var d=E-PREVE;PREVE=E;
  if(d>.045&&t-ONSETT>140){ONSET=1;ONSETT=t}
  ONSET*=.90;
  return ONSET;
}

/* ================= VISUALIZADORES DE FALA ================= */
/* ================= RADIAL v2 =================
   Regras vindas da pesquisa:
   - 28 bandas em escala log, nao 96 hastes (96 vira pente serrilhado)
   - ataque rapido .55 / queda lenta .12  -> leitura de dinamica
   - peak hold 500ms + queda por gravidade (audioMotion): o pico segura e cai
   - curva fechada Catmull-Rom ligando os topos, nao barras soltas (Listening Together)
   - matiz por ELEMENTO, nunca por valor; so alfa e luminancia respondem (Active Theory)
   - fundo nunca preto puro; geometria burra + brilho caro (Audiograph)
   - rastro por realimentacao do proprio frame com zoom+rotacao (MilkDrop)
*/
var NB=28,SM=new Float32Array(NB),PK=new Float32Array(NB),PKT=new Float32Array(NB),BASS=0;
function bandsN(t){
  var lo=0;
  for(var i=0;i<NB;i++){
    var f=Math.pow(i/(NB-1),1.55);            /* escala log-ish */
    var idx=Math.min(23,Math.max(0,Math.round(f*23)));
    var src=BANDS[idx];
    if(i<3)lo+=src;
    var k=src>SM[i]?.55:.12;                  /* ataque x queda */
    SM[i]+=(src-SM[i])*k;
    if(SM[i]>=PK[i]){PK[i]=SM[i];PKT[i]=t}
    else{
      var dt=t-PKT[i];
      if(dt>500){PK[i]-=.0000038*3.8*(dt-500)*16; if(PK[i]<SM[i])PK[i]=SM[i]}
    }
  }
  BASS+=((lo/3)-BASS)*.18;
}
function catmull(ctx,pts,close){
  var n=pts.length;
  ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
  for(var i=0;i<n-(close?0:3);i++){
    var p0=pts[(i-1+n)%n],p1=pts[i%n],p2=pts[(i+1)%n],p3=pts[(i+2)%n];
    ctx.bezierCurveTo(p1[0]+(p2[0]-p0[0])/6,p1[1]+(p2[1]-p0[1])/6,
                      p2[0]-(p3[0]-p1[0])/6,p2[1]-(p3[1]-p1[1])/6,p2[0],p2[1]);
  }
  if(close)ctx.closePath();
}
function ring(CX,CY,R0,arr,amp,rot){
  var p=[];
  for(var i=0;i<NB;i++){
    var a=(i/NB)*6.283+rot;
    var r=R0+arr[i]*amp;
    p.push([CX+Math.cos(a)*r,CY+Math.sin(a)*r]);
  }
  return p;
}
function feedback(ctx,cv,alpha,sc,rot){
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.globalCompositeOperation="source-over";ctx.globalAlpha=alpha;
  ctx.translate(cv.width/2,cv.height/2);ctx.rotate(rot);ctx.scale(sc,sc);
  ctx.translate(-cv.width/2,-cv.height/2);
  try{ctx.drawImage(cv,0,0)}catch(e){}
  ctx.restore();
}

function vAnel(ctx,w,h,t,E){
  bandsN(t);
  ctx.globalCompositeOperation="source-over";
  var g0=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.62);
  g0.addColorStop(0,BG());g0.addColorStop(1,"#03050a");
  ctx.fillStyle=g0;ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,M=Math.min(w,h);
  var R0=M*.30*(1+BASS*.12);                 /* o grave respira o raio inteiro */
  var amp=M*.20;
  ctx.globalCompositeOperation="lighter";
  var pk=ring(CX,CY,R0,PK,amp,0);
  catmull(ctx,pk,true);
  ctx.strokeStyle=COL(.20,.55);ctx.lineWidth=1;ctx.stroke();
  var pts=ring(CX,CY,R0,SM,amp,0);
  catmull(ctx,pts,true);
  var gf=ctx.createRadialGradient(CX,CY,R0*.5,CX,CY,R0+amp);
  gf.addColorStop(0,COL(.16+E*.14,.85));gf.addColorStop(1,COL(0,.5));
  ctx.fillStyle=gf;ctx.fill();
  catmull(ctx,pts,true);
  ctx.strokeStyle=COL(.55+E*.42,.9);ctx.lineWidth=1.7;ctx.stroke();
  ctx.strokeStyle=COL(.06,.3);ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(CX,CY,R0*.78,0,6.283);ctx.stroke();
  var gc=ctx.createRadialGradient(CX,CY,0,CX,CY,R0*.9);
  gc.addColorStop(0,"rgba(255,255,255,"+(.10+E*.30)+")");
  gc.addColorStop(.5,COL(.06+E*.14,1));gc.addColorStop(1,COL(0,1));
  ctx.fillStyle=gc;ctx.beginPath();ctx.arc(CX,CY,R0*.9,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}

function vRastro(ctx,w,h,t,E){
  bandsN(t);
  var cv=ctx.canvas;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  ctx.globalCompositeOperation="source-over";ctx.globalAlpha=.14;
  ctx.fillStyle="#03050a";ctx.fillRect(0,0,cv.width,cv.height);
  ctx.globalAlpha=1;ctx.restore();
  feedback(ctx,cv,.88,.9982,.0062);
  var CX=w/2,CY=h/2,M=Math.min(w,h);
  var R0=M*.26*(1+BASS*.16),amp=M*.17;
  ctx.globalCompositeOperation="lighter";
  var pts=ring(CX,CY,R0,SM,amp,t*.00013);
  catmull(ctx,pts,true);
  ctx.strokeStyle=COL(.34+E*.5,.85);ctx.lineWidth=1.3;ctx.stroke();
  for(var i=0;i<NB;i+=2){
    var a=(i/NB)*6.283+t*.00013,r=R0+PK[i]*amp;
    var x=CX+Math.cos(a)*r,y=CY+Math.sin(a)*r;
    ctx.fillStyle=COL(.25+PK[i]*.7,1);
    ctx.beginPath();ctx.arc(x,y,.9+PK[i]*2.1,0,6.283);ctx.fill();
  }
  var gc=ctx.createRadialGradient(CX,CY,0,CX,CY,R0*.8);
  gc.addColorStop(0,"rgba(255,255,255,"+(.14+E*.34)+")");
  gc.addColorStop(1,COL(0,1));
  ctx.fillStyle=gc;ctx.beginPath();ctx.arc(CX,CY,R0*.8,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}

function vMandala(ctx,w,h,t,E){
  bandsN(t);
  ctx.globalCompositeOperation="source-over";
  var g0=ctx.createRadialGradient(w/2,h/2,0,w/2,h/2,Math.max(w,h)*.6);
  g0.addColorStop(0,BG());g0.addColorStop(1,"#03050a");
  ctx.fillStyle=g0;ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,M=Math.min(w,h),SYM=6;
  ctx.globalCompositeOperation="lighter";
  ctx.lineCap="round";
  for(var lay=0;lay<7;lay++){
    var rr=M*(.10+lay*.045)*(1+BASS*.10);
    var b=SM[(lay*4)%NB],pk=PK[(lay*4)%NB];
    var spin=t*(.00007+lay*.000035)*(lay%2?-1:1);
    for(var s=0;s<SYM;s++){
      var a0=(s/SYM)*6.283+spin;
      var ext=.20+b*.86;
      ctx.strokeStyle=COL(.07+b*.72,.30+b*.6);
      ctx.lineWidth=1.1+b*3.4+lay*.16;
      ctx.beginPath();ctx.arc(CX,CY,rr,a0,a0+ext);ctx.stroke();
      ctx.strokeStyle=COL(.10+pk*.28,.7);ctx.lineWidth=.8;
      ctx.beginPath();ctx.arc(CX,CY,rr+M*.012,a0,a0+.20+pk*.86);ctx.stroke();
    }
  }
  for(var k=0;k<SYM;k++){
    var ak=(k/SYM)*6.283+t*.00005;
    ctx.strokeStyle=COL(.05+E*.12,.4);ctx.lineWidth=.7;
    ctx.beginPath();
    ctx.moveTo(CX+Math.cos(ak)*M*.09,CY+Math.sin(ak)*M*.09);
    ctx.lineTo(CX+Math.cos(ak)*M*.44,CY+Math.sin(ak)*M*.44);ctx.stroke();
  }
  var gc=ctx.createRadialGradient(CX,CY,0,CX,CY,M*.15);
  gc.addColorStop(0,"rgba(255,255,255,"+(.24+E*.4)+")");
  gc.addColorStop(.4,COL(.16+E*.2,1));gc.addColorStop(1,COL(0,1));
  ctx.fillStyle=gc;ctx.beginPath();ctx.arc(CX,CY,M*.15,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}

function vBarras(ctx,w,h,t,E){
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  var N=46,pad=w*.07,iw=w-pad*2,bw=iw/N,cy=h/2;
  ctx.globalCompositeOperation="lighter";
  for(var i=0;i<N;i++){
    var b=BANDS[(i*24/N)|0],v=Math.pow(b,.82);
    var bh=Math.max(2,v*h*.40);
    var x0=pad+i*bw+bw*.16,ww=bw*.68;
    var g=ctx.createLinearGradient(0,cy-bh,0,cy+bh);
    g.addColorStop(0,COL(.06,1));g.addColorStop(.5,COL(.20+v*.8,.4+v*.6));g.addColorStop(1,COL(.06,1));
    ctx.fillStyle=g;ctx.fillRect(x0,cy-bh,ww,bh*2);
    ctx.fillStyle=COL(.35+v*.65,1);
    ctx.fillRect(x0,cy-bh-1.5,ww,2);ctx.fillRect(x0,cy+bh-.5,ww,2);
  }
  ctx.globalCompositeOperation="source-over";
}
function vRadial(ctx,w,h,t,E){
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,R=Math.min(w,h)*.19,N=96;
  ctx.globalCompositeOperation="lighter";
  ctx.lineCap="round";
  for(var i=0;i<N;i++){
    var b=BANDS[(i*24/N)|0]*(.55+.45*Math.sin(i*.7+t*.002));
    var a=(i/N)*6.283-1.5708,L=6+Math.pow(b,.85)*Math.min(w,h)*.26;
    ctx.strokeStyle=COL(.14+b*.86,.35+b*.65);
    ctx.lineWidth=2.4+b*2.6;
    ctx.beginPath();
    ctx.moveTo(CX+Math.cos(a)*R,CY+Math.sin(a)*R);
    ctx.lineTo(CX+Math.cos(a)*(R+L),CY+Math.sin(a)*(R+L));
    ctx.stroke();
  }
  ctx.strokeStyle=COL(.16+E*.4,.8);ctx.lineWidth=1;
  ctx.beginPath();ctx.arc(CX,CY,R-6,0,6.283);ctx.stroke();
  var g=ctx.createRadialGradient(CX,CY,0,CX,CY,R);
  g.addColorStop(0,COL(.10+E*.5,1));g.addColorStop(1,COL(0,1));
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,R,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}
function vOnda(ctx,w,h,t,E){
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  var cy=h/2,pad=w*.05;
  ctx.globalCompositeOperation="lighter";
  for(var pass=0;pass<3;pass++){
    ctx.beginPath();
    for(var x=0;x<=w-pad*2;x+=2){
      var u=x/(w-pad*2),y=0;
      for(var b=0;b<12;b++){
        y+=BANDS[b*2]*Math.sin(u*(3+b*2.4)*6.283+t*(.0016+b*.0004)+pass*.6)/(1+b*.32);
      }
      var Y=cy+y*h*.20*(1-pass*.22);
      x?ctx.lineTo(pad+x,Y):ctx.moveTo(pad+x,Y);
    }
    ctx.strokeStyle=COL((pass===0?.72:.16)*(.3+E*1.4),pass===0?1:.4);
    ctx.lineWidth=pass===0?2.0:1.0;ctx.stroke();
  }
  ctx.strokeStyle=COL(.05,.2);ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(pad,cy);ctx.lineTo(w-pad,cy);ctx.stroke();
  ctx.globalCompositeOperation="source-over";
}
var ECG=[];for(var _e=0;_e<240;_e++)ECG.push(0);
function vBatimento(ctx,w,h,t,E){
  var on=feelOnset(t,E);
  ECG.push(on>.5?(1.0+Math.random()*.25):(E*.30+(Math.random()-.5)*.03));
  ECG.shift();
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="lighter";
  ctx.strokeStyle=COL(.05,.2);ctx.lineWidth=1;
  for(var g=1;g<4;g++){ctx.beginPath();ctx.moveTo(0,h*g/4);ctx.lineTo(w,h*g/4);ctx.stroke()}
  var cy=h*.62,N=ECG.length;
  ctx.beginPath();
  for(var i=0;i<N;i++){
    var x=i/(N-1)*w,y=cy-ECG[i]*h*.44;
    i?ctx.lineTo(x,y):ctx.moveTo(x,y);
  }
  ctx.strokeStyle=COL(.30+E*.7,.5+E*.5);ctx.lineWidth=1.9;ctx.stroke();
  var lx=w,ly=cy-ECG[N-1]*h*.44;
  ctx.fillStyle=COL(.9,1);ctx.beginPath();ctx.arc(lx-2,ly,2.6+E*3,0,6.283);ctx.fill();
  var gg=ctx.createRadialGradient(lx-2,ly,0,lx-2,ly,26+E*40);
  gg.addColorStop(0,COL(.28+E*.4,1));gg.addColorStop(1,COL(0,1));
  ctx.fillStyle=gg;ctx.beginPath();ctx.arc(lx-2,ly,26+E*40,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}
var SPEC=[];
function vEspectro(ctx,w,h,t,E){
  var col=[];for(var b=0;b<24;b++)col.push(BANDS[b]);
  SPEC.push(col);if(SPEC.length>150)SPEC.shift();
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="lighter";
  var cw=w/150,ch=h/24;
  for(var i=0;i<SPEC.length;i++){
    var c=SPEC[i],x=i*cw;
    for(var k=0;k<24;k++){
      var v=c[k];if(v<.03)continue;
      ctx.fillStyle=COL(Math.min(.95,v*1.15),Math.min(1,v*1.5));
      ctx.fillRect(x,h-(k+1)*ch,cw+.6,ch+.6);
    }
  }
  ctx.globalCompositeOperation="source-over";
}
var RINGS2=[];
function vPulso(ctx,w,h,t,E){
  var on=feelOnset(t,E);
  if(on>.5&&RINGS2.length<26)RINGS2.push({t0:t,amp:.5+E*1.1});
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,MR=Math.min(w,h)*.46;
  ctx.globalCompositeOperation="lighter";
  for(var i=RINGS2.length-1;i>=0;i--){
    var age=(t-RINGS2[i].t0)/2000;
    if(age>1){RINGS2.splice(i,1);continue}
    var r=age*MR,al=(1-age)*(1-age)*RINGS2[i].amp;
    ctx.strokeStyle=COL(Math.min(.9,al),.4+al);
    ctx.lineWidth=(1-age)*3.4+.4;
    ctx.beginPath();ctx.arc(CX,CY,r,0,6.283);ctx.stroke();
  }
  var cr=Math.min(w,h)*(.055+E*.075);
  var g=ctx.createRadialGradient(CX,CY,0,CX,CY,cr*3.4);
  g.addColorStop(0,"rgba(255,255,255,"+(.5+E*.45)+")");
  g.addColorStop(.14,COL(.5+E*.4,1));g.addColorStop(1,COL(0,1));
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,cr*3.4,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}
var NET=null;
function buildNet(){
  var L=[6,10,10,6],N=[],y;
  for(var l=0;l<L.length;l++){
    var lay=[];
    for(var i=0;i<L[l];i++)lay.push({a:0,x:l/(L.length-1),y:(i+.5)/L[l]});
    N.push(lay);
  }
  var Ws=[];
  for(var l2=0;l2<N.length-1;l2++){
    var ws=[];
    for(var i2=0;i2<N[l2].length;i2++){
      var row=[];
      for(var j=0;j<N[l2+1].length;j++)row.push(Math.random()*2-1);
      ws.push(row);
    }
    Ws.push(ws);
  }
  return {N:N,W:Ws};
}
function vNeural(ctx,w,h,t,E){
  if(!NET)NET=buildNet();
  var N=NET.N,W=NET.W,l,i,j;
  for(i=0;i<N[0].length;i++)N[0][i].a=BANDS[(i*4)%24];
  for(l=0;l<N.length-1;l++){
    for(j=0;j<N[l+1].length;j++){
      var s=0;
      for(i=0;i<N[l].length;i++)s+=N[l][i].a*W[l][i][j];
      var v=1/(1+Math.exp(-s*2.2));
      N[l+1][j].a+=(Math.max(0,v-.42)*1.7-N[l+1][j].a)*.22;
    }
  }
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="lighter";
  var px=w*.13,py=h*.13,iw=w-px*2,ih=h-py*2;
  function P(n){return [px+n.x*iw,py+n.y*ih]}
  for(l=0;l<N.length-1;l++){
    for(i=0;i<N[l].length;i++){
      for(j=0;j<N[l+1].length;j++){
        var a=N[l][i].a*Math.abs(W[l][i][j]);
        if(a<.035)continue;
        var p0=P(N[l][i]),p1=P(N[l+1][j]);
        ctx.strokeStyle=COL(Math.min(.7,a*.9),.3+a);
        ctx.lineWidth=.4+a*2.2;
        ctx.beginPath();ctx.moveTo(p0[0],p0[1]);ctx.lineTo(p1[0],p1[1]);ctx.stroke();
        var ph=((t*.0009+i*.13+j*.07)%1);
        if(a>.16){
          var qx=p0[0]+(p1[0]-p0[0])*ph,qy=p0[1]+(p1[1]-p0[1])*ph;
          ctx.fillStyle=COL(Math.min(.95,a*1.5),1);
          ctx.beginPath();ctx.arc(qx,qy,1.4+a*2,0,6.283);ctx.fill();
        }
      }
    }
  }
  for(l=0;l<N.length;l++){
    for(i=0;i<N[l].length;i++){
      var n=N[l][i],p=P(n),a2=n.a;
      var gg=ctx.createRadialGradient(p[0],p[1],0,p[0],p[1],9+a2*22);
      gg.addColorStop(0,COL(.25+a2*.7,1));gg.addColorStop(1,COL(0,1));
      ctx.fillStyle=gg;ctx.beginPath();ctx.arc(p[0],p[1],9+a2*22,0,6.283);ctx.fill();
      ctx.fillStyle=COL(.3+a2*.7,.4+a2*.6);
      ctx.beginPath();ctx.arc(p[0],p[1],2.2+a2*3.4,0,6.283);ctx.fill();
    }
  }
  ctx.globalCompositeOperation="source-over";
}


/* ================= SIRI ORB (porte fiel do smoothui.dev) ================= */
var SIRIPAL={
  azul:{c1:"#4d8bff",c2:"#2450c8",c3:"#a9c6ff",c4:"#132a63",bg:"#05080f",glow:"#4d8bff"},
  roxo:{c1:"#a855f7",c2:"#6d28d9",c3:"#dcb6ff",c4:"#340a63",bg:"#080410",glow:"#a855f7"},
  ouro:{c1:"#f0a54a",c2:"#c06a10",c3:"#ffd79a",c4:"#5f2f04",bg:"#0c0803",glow:"#f0a54a"}
};
function siriMake(size){
  var wrap=document.createElement("div");wrap.className="siri-wrap";
  wrap.style.width=size+"px";wrap.style.height=size+"px";
  var bloom=document.createElement("div");bloom.className="siri-bloom";
  var orb=document.createElement("div");orb.className="siri-orb";
  orb.style.width="100%";orb.style.height="100%";
  var sheen=document.createElement("span");sheen.className="siri-orb-layer siri-orb-sheen";sheen.setAttribute("aria-hidden","true");
  var rim=document.createElement("span");rim.className="siri-orb-layer siri-orb-rim";rim.setAttribute("aria-hidden","true");
  orb.appendChild(sheen);orb.appendChild(rim);
  wrap.appendChild(bloom);wrap.appendChild(orb);
  var s=orb.style;
  s.setProperty("--drift-duration","11s");
  s.setProperty("--contrast-amount","1.9");
  s.setProperty("--shadow-spread",Math.round(size*0.34)+"px");
  s.setProperty("--blur-amount",(size*0.085)+"px");
  for(var q=1;q<=7;q++)s.setProperty("--a"+q,"0deg");
  s.setProperty("--dot-size",Math.max(0.9,size*0.008)+"px");
  s.setProperty("--mask-radius","34%");
  s.setProperty("--rim",Math.max(1.2,size*0.022)+"px");
  wrap._orb=orb;wrap._bloom=bloom;wrap._size=size;
  return wrap;
}
function siriPaint(wrap){
  var p=SIRIPAL[PAL]||SIRIPAL.azul,s=wrap._orb.style;
  s.setProperty("--c1",p.c1);s.setProperty("--c2",p.c2);
  s.setProperty("--c3",p.c3);s.setProperty("--c4",p.c4);s.setProperty("--bg",p.bg);
  wrap._bloom.style.background="radial-gradient(circle at 50% 50%,"+p.glow+" 0%,transparent 64%)";
  wrap._bloom.style.filter="blur("+(wrap._size*0.14)+"px)";
}
function siriUpdate(wrap,t,E){
  if(wrap._pal!==PAL){wrap._pal=PAL;siriPaint(wrap)}
  var sz=wrap._size,o=wrap._orb.style;
  /* os sete gradientes giram em velocidades e sentidos diferentes: e isso que
     faz a massa se enrolar por dentro em vez de girar como um disco so */
  var a=t*0.0125,SP=[2,2,-3,1.5,2,1,-2],EX=[0,37,113,211,59,167,293];
  for(var i=0;i<7;i++)o.setProperty("--a"+(i+1),(a*SP[i]+EX[i]).toFixed(2)+"deg");
  /* nevoa: quanto mais silencio, mais borrado e difuso */
  var lvl=Math.min(1,E*1.5);
  o.setProperty("--blur-amount",(sz*(0.085-lvl*0.038)).toFixed(2)+"px");
  o.setProperty("--contrast-amount",(1.7+lvl*1.5).toFixed(2));
  var breathe=1+Math.sin(t*0.0011)*0.014;
  var dx=Math.sin(t*0.00043)*sz*0.014,dy=Math.cos(t*0.00037)*sz*0.012;
  wrap._orb.style.transform="translate("+dx.toFixed(2)+"px,"+dy.toFixed(2)+"px) scale("+(breathe+lvl*0.09).toFixed(4)+")";
  wrap._bloom.style.opacity=(0.34+lvl*0.5).toFixed(3);
}

var TZ=[];for(var _i=0;_i<64;_i++)TZ.push({z:_i/64,seed:Math.random()*100,spin:-1+Math.random()*2});
var STARS=[];for(var _s=0;_s<220;_s++)STARS.push([Math.random(),Math.random(),Math.pow(Math.random(),3)]);
var PP=[];for(var _p=0;_p<300;_p++)PP.push({a:rnd(0,6.283),r:rnd(.2,1.9),v:rnd(.0006,.0028),s:rnd(.6,2.1)});
var GYRO=[];for(var _g=0;_g<6;_g++)GYRO.push({r:.42-_g*.055,tx:rnd(0,3.14),ty:rnd(0,3.14),sx:rnd(-.00026,.00026),sy:rnd(-.0002,.0002),tk:1+_g*.35});
function cTunel(ctx,w,h,t,E){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,M=Math.min(w,h);
  ctx.globalCompositeOperation="lighter";
  var speed=.00011*(1+E*1.6);
  for(var i=0;i<TZ.length;i++){
    var R=TZ[i];
    var z=(R.z + t*speed)%1;
    var d=.02+z*z*2.6;                 /* perspectiva: cresce rapido no fim */
    var rad=M*.055/d*3.2;
    if(rad>M*2.4)continue;
    var fade2=Math.min(1,(1-z)*2.6)*Math.min(1,z*7);
    var seg=32,rot=R.spin*t*.00016+R.seed;
    ctx.beginPath();
    for(var k=0;k<=seg;k++){
      var a=(k/seg)*6.283+rot;
      var wob=1+vn(Math.cos(a)*2+R.seed,Math.sin(a)*2,R.seed)*.14*(1+E);
      var x=CX+Math.cos(a)*rad*wob,y=CY+Math.sin(a)*rad*wob*.94;
      k?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();
    ctx.strokeStyle=COL(fade2*(.10+E*.30),.25+z*.7);
    ctx.lineWidth=.6+ (1-z)*1.8;
    ctx.stroke();
    for(var s=0;s<10;s++){
      var a2=(s/10)*6.283+rot*1.7;
      var r0=rad*.86,r1=rad*1.0;
      ctx.strokeStyle=COL(fade2*(.14+E*.5),.5+z*.5);ctx.lineWidth=.8+(1-z)*1.4;
      ctx.beginPath();
      ctx.moveTo(CX+Math.cos(a2)*r0,CY+Math.sin(a2)*r0*.94);
      ctx.lineTo(CX+Math.cos(a2)*r1,CY+Math.sin(a2)*r1*.94);ctx.stroke();
    }
  }
  var g=ctx.createRadialGradient(CX,CY,0,CX,CY,M*.30);
  g.addColorStop(0,"rgba(255,255,255,"+(.5+E*.4)+")");
  g.addColorStop(.12,COL(.4+E*.3,1));g.addColorStop(1,COL(0,1));
  ctx.fillStyle=g;ctx.beginPath();ctx.arc(CX,CY,M*.30,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
  var v=ctx.createRadialGradient(CX,CY,M*.30,CX,CY,M*.95);
  v.addColorStop(0,"rgba(0,0,0,0)");v.addColorStop(1,"rgba(0,0,0,.75)");
  ctx.fillStyle=v;ctx.fillRect(0,0,w,h);
}

function cPlaneta(ctx,w,h,t,E){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="#020409";ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="lighter";
  for(var s=0;s<STARS.length;s++){
    var S=STARS[s],tw=.35+.65*Math.abs(Math.sin(t*.0007+s));
    ctx.fillStyle="rgba(210,225,255,"+(S[2]*.75*tw)+")";
    ctx.fillRect(S[0]*w,S[1]*h,1.1+S[2],1.1+S[2]);
  }
  var CX=w*.5,CY=h*.54,R=Math.min(w,h)*.30*(1+E*.03);
  var LX=-.55,LY=-.42;                       /* direcao da luz */
  var amb=ctx.createRadialGradient(CX,CY,R*.92,CX,CY,R*1.55);
  amb.addColorStop(0,COL(.34+E*.22,.55));amb.addColorStop(.45,COL(.10,.4));amb.addColorStop(1,COL(0,.4));
  ctx.fillStyle=amb;ctx.beginPath();ctx.arc(CX,CY,R*1.55,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
  ctx.save();ctx.beginPath();ctx.arc(CX,CY,R,0,6.283);ctx.clip();
  ctx.fillStyle="#05070d";ctx.fillRect(CX-R,CY-R,R*2,R*2);
  var off=t*.00004;
  for(var y=-R;y<R;y+=2){
    var lat=y/R;
    var n=vn(off*40, lat*3.2, 0)*.5+.5;
    var n2=vn(off*23+10, lat*7.5, 4)*.5+.5;
    var b=(n*.65+n2*.35);
    var sh=Math.max(0,1-Math.abs(lat-LY)*.9);
    ctx.fillStyle=COL(.05+b*.24*sh,.15+b*.5);
    ctx.fillRect(CX-R,CY+y,R*2,2.2);
  }
  var lit=ctx.createRadialGradient(CX+LX*R,CY+LY*R,0,CX+LX*R,CY+LY*R,R*2.0);
  lit.addColorStop(0,COL(.55+E*.2,.95));lit.addColorStop(.35,COL(.14,.6));lit.addColorStop(1,"rgba(0,0,0,.86)");
  ctx.globalCompositeOperation="overlay";ctx.fillStyle=lit;
  ctx.fillRect(CX-R,CY-R,R*2,R*2);
  ctx.restore();
  ctx.globalCompositeOperation="lighter";
  ctx.lineWidth=1.6;
  for(var k=0;k<3;k++){
    ctx.strokeStyle=COL((.30-k*.08)*(1+E*.5),.9);
    ctx.beginPath();ctx.arc(CX,CY,R+k*1.6,Math.PI*.62,Math.PI*2.02);ctx.stroke();
  }
  var atm=ctx.createRadialGradient(CX,CY,R*.98,CX,CY,R*1.22);
  atm.addColorStop(0,COL(.22+E*.2,.85));atm.addColorStop(1,COL(0,.85));
  ctx.fillStyle=atm;ctx.beginPath();ctx.arc(CX,CY,R*1.22,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}

function cPortal(ctx,w,h,t,E){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="#010308";ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,M=Math.min(w,h),R=M*.27*(1+E*.05);
  ctx.globalCompositeOperation="lighter";
  ctx.save();ctx.beginPath();ctx.ellipse(CX,CY,R,R*1.06,0,0,6.283);ctx.clip();
  for(var i=0;i<34;i++){
    var ph=t*.00022+i*.31;
    var rr=R*(.10+((i/34+t*.00007)%1)*1.05);
    var wob=1+vn(Math.cos(ph)*2,Math.sin(ph)*2,i*.3+t*.00013)*.30;
    ctx.strokeStyle=COL(.03+ (1-rr/R/1.05)*.16*(1+E*1.6),.3+(i%7)/7*.6);
    ctx.lineWidth=1+ (1-rr/(R*1.05))*2.6;
    ctx.beginPath();
    for(var k=0;k<=40;k++){
      var a=(k/40)*6.283+ph*2.2;
      var q=rr*wob*(1+vn(Math.cos(a)*3+i,Math.sin(a)*3,t*.00021)*.16);
      var x=CX+Math.cos(a)*q,y=CY+Math.sin(a)*q*1.06;
      k?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();ctx.stroke();
  }
  var inner=ctx.createRadialGradient(CX,CY,0,CX,CY,R);
  inner.addColorStop(0,"rgba(255,255,255,"+(.30+E*.35)+")");
  inner.addColorStop(.30,COL(.22+E*.2,1));inner.addColorStop(1,COL(.02,.5));
  ctx.fillStyle=inner;ctx.fillRect(CX-R,CY-R*1.1,R*2,R*2.2);
  ctx.restore();
  for(var k2=0;k2<4;k2++){
    ctx.strokeStyle=COL((.55-k2*.12)*(1+E*.5),.8+k2*.05);
    ctx.lineWidth=(5-k2)*1.5;
    ctx.beginPath();ctx.ellipse(CX,CY,R+k2*2.2,(R+k2*2.2)*1.06,0,0,6.283);ctx.stroke();
  }
  for(var p=0;p<PP.length;p++){
    var P=PP[p];
    P.r-=P.v*(1+E*2.2)*16;if(P.r<.16){P.r=rnd(1.5,2.1);P.a=rnd(0,6.283)}
    P.a+=.0016*(1+E)*(1/Math.max(.2,P.r));
    var x2=CX+Math.cos(P.a)*R*P.r,y2=CY+Math.sin(P.a)*R*P.r*1.06;
    var al=Math.min(1,(2.1-P.r)*.7)*.5;
    ctx.fillStyle=COL(al,.7);ctx.fillRect(x2,y2,P.s,P.s);
  }
  var gl=ctx.createRadialGradient(CX,CY,R*.7,CX,CY,R*2.4);
  gl.addColorStop(0,COL(.16+E*.2,.9));gl.addColorStop(1,COL(0,.9));
  ctx.fillStyle=gl;ctx.beginPath();ctx.arc(CX,CY,R*2.4,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
  var v2=ctx.createRadialGradient(CX,CY,R*1.1,CX,CY,M*1.05);
  v2.addColorStop(0,"rgba(0,0,0,0)");v2.addColorStop(1,"rgba(0,0,0,.9)");
  ctx.fillStyle=v2;ctx.fillRect(0,0,w,h);
}

function cMaquina(ctx,w,h,t,E){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle=BG();ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,M=Math.min(w,h);
  ctx.globalCompositeOperation="lighter";
  for(var g=0;g<GYRO.length;g++){
    var G=GYRO[g],tx=G.tx+t*G.sx*(1+E*1.4),ty=G.ty+t*G.sy*(1+E*1.4);
    var ctx1=Math.cos(tx),stx=Math.sin(tx),cty=Math.cos(ty),sty=Math.sin(ty);
    ctx.beginPath();
    for(var k=0;k<=90;k++){
      var a=(k/90)*6.283;
      var X=Math.cos(a),Y=Math.sin(a),Z=0;
      var y1=Y*ctx1-Z*stx,z1=Y*stx+Z*ctx1;
      var x1=X*cty+z1*sty,z2=-X*sty+z1*cty;
      var sc=1/(2.7-z2*.85);
      var px=CX+x1*M*G.r*2.3*sc,py=CY+y1*M*G.r*2.3*sc;
      k?ctx.lineTo(px,py):ctx.moveTo(px,py);
    }
    ctx.closePath();
    ctx.strokeStyle=COL(.16+E*.4,.3+g*.11);ctx.lineWidth=G.tk*(1+E*.5);ctx.stroke();
    for(var s=0;s<26;s++){
      var a3=(s/26)*6.283;
      var X2=Math.cos(a3),Y2=Math.sin(a3);
      var y2=Y2*ctx1,z3=Y2*stx;
      var x2=X2*cty+z3*sty,z4=-X2*sty+z3*cty;
      var sc2=1/(2.7-z4*.85),dep=(z4+1)/2;
      ctx.fillStyle=COL((.12+dep*.5)*(1+E*.8),.5+dep*.5);
      var q=1.1+dep*1.7;
      ctx.fillRect(CX+x2*M*G.r*2.3*sc2,CY+y2*M*G.r*2.3*sc2,q,q);
    }
  }
  for(var b=0;b<7;b++){
    var ab=(b/7)*6.283+t*.00019;
    ctx.strokeStyle=COL(.06+E*.22,.6);ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(CX+Math.cos(ab)*M*.08,CY+Math.sin(ab)*M*.08);
    ctx.lineTo(CX+Math.cos(ab)*M*.42,CY+Math.sin(ab)*M*.42);ctx.stroke();
  }
  var hr=M*(.075+E*.075);
  var hg=ctx.createRadialGradient(CX,CY,0,CX,CY,hr*4.2);
  hg.addColorStop(0,"rgba(255,255,255,"+(.72+E*.26)+")");
  hg.addColorStop(.09,COL(.5+E*.3,1));hg.addColorStop(.32,COL(.16,1));hg.addColorStop(1,COL(0,1));
  ctx.fillStyle=hg;ctx.beginPath();ctx.arc(CX,CY,hr*4.2,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}


function cOrbeAnel(ctx,w,h,t,E){
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="#03030a";ctx.fillRect(0,0,w,h);
  var CX=w/2,CY=h/2,M=Math.min(w,h),R=M*.21*(1+E*.05);
  ctx.globalCompositeOperation="lighter";
  var far=ctx.createRadialGradient(CX,CY,R*.6,CX,CY,M*.62);
  far.addColorStop(0,"rgba(66,50,190,"+(.30+E*.16)+")");
  far.addColorStop(.45,"rgba(38,26,120,.16)");far.addColorStop(1,"rgba(10,6,40,0)");
  ctx.fillStyle=far;ctx.fillRect(0,0,w,h);
  ctx.save();
  ctx.beginPath();ctx.arc(CX,CY,R,0,6.283);ctx.clip();
  var ig=ctx.createRadialGradient(CX-R*.2,CY-R*.25,0,CX,CY,R*1.15);
  ig.addColorStop(0,"rgba(255,190,225,"+(.85+E*.15)+")");
  ig.addColorStop(.45,"rgba(196,110,220,.75)");
  ig.addColorStop(1,"rgba(96,60,190,.6)");
  ctx.fillStyle=ig;ctx.fillRect(CX-R,CY-R,R*2,R*2);
  for(var b=0;b<4;b++){
    var ph=t*.00016+b*1.9;
    var bx=CX+Math.cos(ph*1.4+b)*R*.32,by=CY+Math.sin(ph*1.1+b*2)*R*.30;
    var br=R*(.42+.16*Math.sin(ph*2+b));
    var bg=ctx.createRadialGradient(bx,by,0,bx,by,br);
    bg.addColorStop(0,b%2?"rgba(255,140,205,.34)":"rgba(120,90,255,.30)");
    bg.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=bg;ctx.beginPath();ctx.arc(bx,by,br,0,6.283);ctx.fill();
  }
  ctx.restore();
  /* o anel: varias voltas quase circulares, borradas, com brilho variando ao longo */
  for(var k=0;k<26;k++){
    var kk=k/26, sp=t*.00021+kk*.9;
    var rr=R*(1.0+kk*.30)+Math.sin(sp*1.7)*R*.05;
    var tilt=Math.sin(sp*.8+kk*3.1)*.32;
    ctx.beginPath();
    for(var s=0;s<=72;s++){
      var a=(s/72)*6.283;
      var wob=1+vn(Math.cos(a)*1.6+kk*3,Math.sin(a)*1.6,sp*.8)*.16;
      var x=CX+Math.cos(a)*rr*wob,y=CY+Math.sin(a)*rr*wob*(1-Math.abs(tilt)*.42);
      s?ctx.lineTo(x,y):ctx.moveTo(x,y);
    }
    ctx.closePath();
    var al=(.020+ (1-kk)*.055)*(1+E*1.5);
    ctx.strokeStyle="rgba("+(170+kk*85|0)+","+(190+kk*60|0)+",255,"+al+")";
    ctx.lineWidth=.7+(1-kk)*2.6;
    ctx.stroke();
  }
  var rg=ctx.createRadialGradient(CX,CY,R*.94,CX,CY,R*1.22);
  rg.addColorStop(0,"rgba(0,0,0,0)");
  rg.addColorStop(.5,"rgba(210,225,255,"+(.34+E*.3)+")");
  rg.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=rg;ctx.beginPath();ctx.arc(CX,CY,R*1.22,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
  var v=ctx.createRadialGradient(CX,CY,M*.30,CX,CY,M*.86);
  v.addColorStop(0,"rgba(0,0,0,0)");v.addColorStop(1,"rgba(0,0,0,.82)");
  ctx.fillStyle=v;ctx.fillRect(0,0,w,h);
}

function cCirculo(ctx,w,h,t,E){
  var CX=w/2,CY=h/2,M=Math.min(w,h),R=M*.36;
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="#000";ctx.fillRect(0,0,w,h);
  ctx.globalCompositeOperation="lighter";

  /* o fio: 1px, com um realce longo e macio percorrendo ele devagar */
  for(var seg=0;seg<160;seg++){
    var a0=(seg/160)*6.283,a1=((seg+1)/160)*6.283;
    var sh=Math.pow(Math.max(0,Math.cos(a0-t*.00026)),5);
    ctx.strokeStyle="rgba(240,244,252,"+(.26+sh*.34)+")";
    ctx.lineWidth=.9+sh*.5;
    ctx.beginPath();ctx.arc(CX,CY,R,a0,a1+.003);ctx.stroke();
  }

  /* dois trechos onde a luz espalha para dentro. sem fogo: branco frio,
     um traco de calor so no primeiro decimo do caminho */
  var A0=[-0.62+t*.000052,2.52-t*.000041];
  for(var q=0;q<2;q++){
    var base=A0[q]+Math.sin(t*.00011+q*2.1)*.10;
    var band=BANDS[q?14:5];
    var soft=Math.pow(band,.8);
    var spread=.50+soft*.30;
    for(var i=0;i<260;i++){
      var f=i/260;
      var a=base+(f-.5)*spread*2;
      var edge=Math.cos((f-.5)*Math.PI);
      var jag=vn(Math.cos(a)*5.5,Math.sin(a)*5.5,t*.000085+q*3);
      var jag2=vn(Math.cos(a)*17,Math.sin(a)*17,t*.00012+q);
      var len=R*(.015+.17*edge*edge*(.45+jag*.55+jag2*.22)*(1+soft*.55));
      var al=.40*edge*edge*(.30+jag*.7)*(.5+soft*.9);
      if(al<.010)continue;
      var x0=CX+Math.cos(a)*R,y0=CY+Math.sin(a)*R;
      var x1=CX+Math.cos(a)*(R-len),y1=CY+Math.sin(a)*(R-len);
      var g=ctx.createLinearGradient(x0,y0,x1,y1);
      g.addColorStop(0,"rgba(248,250,255,"+Math.min(1,al)+")");
      g.addColorStop(.10,"rgba(226,214,206,"+(al*.72)+")");
      g.addColorStop(.45,"rgba(150,158,178,"+(al*.26)+")");
      g.addColorStop(1,"rgba(90,100,124,0)");
      ctx.strokeStyle=g;ctx.lineWidth=1.15;
      ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    }
    /* halo frio e contido, so no encosto do arco */
    var gx=CX+Math.cos(base)*R,gy=CY+Math.sin(base)*R;
    var gg=ctx.createRadialGradient(gx,gy,0,gx,gy,R*(.20+soft*.12));
    gg.addColorStop(0,"rgba(226,234,250,"+(.06+soft*.16)+")");
    gg.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=gg;ctx.beginPath();ctx.arc(gx,gy,R*(.20+soft*.12),0,6.283);ctx.fill();
  }
  ctx.globalCompositeOperation="source-over";
}



/* ---- blob em WebGL ---- */
function makeGL(cv){
  var g=cv.getContext("webgl2",{antialias:false,alpha:false});
  if(!g)return null;
  function sh(ty,src){var s=g.createShader(ty);g.shaderSource(s,src.trim());g.compileShader(s);
    if(!g.getShaderParameter(s,g.COMPILE_STATUS)){console.warn(g.getShaderInfoLog(s));return null}return s}
  var pr=g.createProgram(),a=sh(g.VERTEX_SHADER,VS_SRC),
      b=sh(g.FRAGMENT_SHADER,FS_SRC);
  if(!a||!b)return null;
  g.attachShader(pr,a);g.attachShader(pr,b);g.linkProgram(pr);
  if(!g.getProgramParameter(pr,g.LINK_STATUS)){console.warn(g.getProgramInfoLog(pr));return null}
  g.useProgram(pr);
  var bf=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,bf);
  g.bufferData(g.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),g.STATIC_DRAW);
  var lo=g.getAttribLocation(pr,"a");g.enableVertexAttribArray(lo);g.vertexAttribPointer(lo,2,g.FLOAT,false,0,0);
  return {g:g,uR:g.getUniformLocation(pr,"R"),uT:g.getUniformLocation(pr,"T"),uA:g.getUniformLocation(pr,"A"),
          uAA:g.getUniformLocation(pr,"AA"),uP:g.getUniformLocation(pr,"PAL"),uRot:g.getUniformLocation(pr,"ROT")};
}
function drawGL(G,cv,t,E,q){
  if(!G)return;
  var d=Math.min(devicePixelRatio||1,2)*q,r=cv.getBoundingClientRect();
  var W=Math.max(1,(r.width*d)|0),H=Math.max(1,(r.height*d)|0);
  if(cv.width!==W||cv.height!==H){cv.width=W;cv.height=H}
  G.g.viewport(0,0,W,H);
  G.g.uniform2f(G.uR,W,H);G.g.uniform1f(G.uT,t/1000);G.g.uniform1f(G.uA,E);
  G.g.uniform1f(G.uAA,0);G.g.uniform1f(G.uP,1);G.g.uniform1f(G.uRot,1);
  G.g.drawArrays(G.g.TRIANGLES,0,3);
}


/* ================= PO v2: nebulosa de particulas 3D =================
   Refeita a pedido ("mais realista, mais real e sensivel ao som"). Tres
   camadas: glow central (sprite pre-renderizado, respiracao MINIMA) + casca
   de particulas 3D com profundidade REAL (tras: menor/escuro; frente:
   maior/brilhante) + halo de motes soltos derivando em volta. Blending
   aditivo + RASTRO (fade parcial em vez de clear total) da o look de
   materia viva. Movimento: flow-field barato por particula (deriva propria
   em lon + balanco em lat, seeds individuais) — nunca pulso uniforme.
   SOM REAL: E/BANDS vem de AnalyserNode (mic do visitante em escuta /
   playback da Dora em fala): grave dispara ondas radiais varrendo a casca,
   RMS abre o bloom do glow, transiente de silaba da o kick de dispersao.
   Contagem ADAPTATIVA: nasce em 9k e degrada 30% se o FPS cair de 45. */
var POP=null,POHALO=null,POGLOW=null;
var PON=14000;
var POSZ=1;      /* fator global de tamanho: 1o estagio do guard de FPS */
var POKICK=0;    /* sacudida por transiente de voz (decai sozinha) */
var POFPS={t:0,n:0,fps:60,checked:0};
/* humor por fase da conversa (setMood na API): muda deriva, cintilacao,
   contracao e redemoinho — a assinatura visual de cada estado */
var POMOOD="calma";
var POMOODP={
  calma:     {drift:1,   twk:.10, contract:1,    swirl:0,      piso:1.0 },
  sentinela: {drift:1,   twk:.24, contract:1,    swirl:0,      piso:1.12},
  escutando: {drift:1.25,twk:.14, contract:1,    swirl:0,      piso:1.22},
  pensando:  {drift:.9,  twk:.12, contract:.955, swirl:.00035, piso:1.08},
  falando:   {drift:1.1, twk:.12, contract:1,    swirl:.00012, piso:1.2 }
};
/* strings de fillStyle pre-computadas: 9k concat por frame e alocacao a toa */
var POAL=[];for(var _pa=0;_pa<24;_pa++)POAL.push("rgba(255,255,255,"+(_pa/23).toFixed(3)+")");
function buildPo(){
  var a=[];
  for(var i=0;i<PON;i++){
    /* uniforme NA SUPERFICIE (asin): a silhueta adensa sozinha na projecao */
    var la=Math.asin(2*Math.random()-1);
    var lo=Math.random()*6.283;
    a.push({la:la,lo:lo,
            /* flow-field: deriva propria em lon (sentido/velocidade individuais)
               + balancinho em lat — cada particula anda seu caminho na casca */
            w:(.00002+Math.random()*.00006)*(Math.random()<.5?-1:1),
            f1:.3+Math.random()*.8,p1:Math.random()*6.283,a1:.02+Math.random()*.05,
            f2:.2+Math.random()*.6,p2:Math.random()*6.283,a2:.012+Math.random()*.035,
            r:1+(Math.random()-.5)*.05,        /* casca com espessura minima */
            b:.3+Math.pow(Math.random(),1.5)*.7,
            s:Math.random()<.10?1.25:.8,   /* poeira FINA: delicada, numerosa */
            bd:(i*7)%24,
            tf:.5+Math.random()*1.2,tw:Math.random()*6.283,
            /* po mexido pelo ponteiro (zerado = fisica nem roda) */
            ox:0,oy:0,wx:0,wy:0});
  }
  return a;
}
function buildHalo(){
  /* motes soltos em volta da esfera: poucos, lentos, esmaecidos */
  var a=[];
  for(var i=0;i<240;i++){
    a.push({la:Math.asin(2*Math.random()-1),lo:Math.random()*6.283,
            r:1.16+Math.pow(Math.random(),1.6)*.62,
            w:(.00001+Math.random()*.000045)*(Math.random()<.5?-1:1),
            f:.15+Math.random()*.4,p:Math.random()*6.283,
            b:.10+Math.random()*.30,s:.9+Math.random()*1.3});
  }
  return a;
}
function poGlow(){
  /* sprite do glow pre-renderizado UMA vez: drawImage por frame, zero alocacao */
  var cv=document.createElement("canvas");cv.width=cv.height=256;
  var c=cv.getContext("2d");
  var g=c.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0,"rgba(185,200,255,.60)");
  g.addColorStop(.38,"rgba(130,150,225,.16)");
  g.addColorStop(1,"rgba(0,0,0,0)");
  c.fillStyle=g;c.fillRect(0,0,256,256);
  return cv;
}
/* buffers das frentes de onda (reusados por frame — nada aloca no loop) */
var POWF=new Float32Array(8),POWA=new Float32Array(8),POWX=[null,null,null,null,null,null,null,null];
var POW=[],POPREV=0,POLAST=-9999;
/* Ponteiro sobre a esfera: mouse no desktop, dedo no celular. So marca posicao
   e velocidade — a fisica acontece por particula, dentro do vPo. */
var POPTR={on:false,x:0,y:0,sp:0,t:-9999};
function poPtrAttach(cv){
  if(cv._poPtr)return;cv._poPtr=1;
  /* touch-action SO no canvas: a tela de voz nao rola, e sem isso o browser
     rouba o pointermove do dedo pra tentar scroll */
  cv.style.touchAction="none";
  var last=null;
  var mv=function(e){
    var r=cv.getBoundingClientRect();if(!r.width)return;
    var x=(e.clientX-r.left)*(cv.width/r.width),y=(e.clientY-r.top)*(cv.height/r.height);
    var n=performance.now();
    if(last){var dd=Math.hypot(x-last.x,y-last.y),dtm=Math.max(1,n-last.t);
      POPTR.sp=POPTR.sp*.6+Math.min(1,(dd/dtm)*.9)*.4;}
    last={x:x,y:y,t:n};
    POPTR.x=x;POPTR.y=y;POPTR.on=true;POPTR.t=n;
  };
  var off=function(){POPTR.on=false;last=null;};
  cv.addEventListener("pointermove",mv);
  cv.addEventListener("pointerdown",mv);
  cv.addEventListener("pointerleave",off);
  cv.addEventListener("pointercancel",off);
}
/* Em repouso a esfera fica PARADA. O giro nao vem do relogio: ele acumula
   proporcional a voz, com uma zona morta pra respiro/ruido de fundo nao
   fazer a esfera derivar sozinha. Silencio = imovel. */
var POROT=0,POPREV=0,POLAST=-9999,POTPREV=0;
var PO_DEADZONE=.22;   /* abaixo disso e silencio: o giro rapido nao acumula */
var PO_YAW0=-.42,PO_PIT0=.16;  /* pose de repouso: leve 3/4, nao de frente */

function vPo(ctx,w,h,t,E){
  if(!POP){POP=buildPo();POHALO=buildHalo();}
  if(!POGLOW)POGLOW=poGlow();
  poPtrAttach(ctx.canvas);
  if(POPTR.on&&performance.now()-POPTR.t>160)POPTR.on=false;

  /* FPS adaptativo: 3 janelas de 2s no boot; abaixo de 45fps corta 30% */
  POFPS.n++;
  if(!POFPS.t)POFPS.t=t;
  else if(t-POFPS.t>2000){
    POFPS.fps=POFPS.n*1000/(t-POFPS.t);POFPS.n=0;POFPS.t=t;
    if(POFPS.checked<4){POFPS.checked++;
      if(POFPS.fps<45){
        /* 1o estagio: afina o desenho; so depois corta contagem */
        if(POSZ>.85)POSZ=.8;
        else if(PON>5200){PON=(PON*.75)|0;POP=null;return;}
      }}
  }

  var MD=POMOODP[POMOOD]||POMOODP.calma;

  /* RASTRO: fade parcial em vez de clear — o brilho de um frame vaza pro
     seguinte e o movimento ganha corpo (materia, nao pontinhos) */
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="rgba(0,0,0,.42)";
  ctx.fillRect(0,0,w,h);

  var CX=w/2,CY=h/2,M=Math.min(w,h);

  /* audio real (AnalyserNode via BANDS). A voz NAO vira onda varrendo a
     casca (rejeitado pelo dono): ela AGITA as particulas — amplitude manda na
     intensidade da danca individual, transiente da uma sacudida que assenta.
     "Poeira dancando com o som", nao "superficie ondulando". */
  var bass=(BANDS[0]+BANDS[1]+BANDS[2]+BANDS[3])*.25;
  var dE=E-POPREV;POPREV=E;
  if(dE>.03)POKICK=Math.min(1,POKICK+dE*5);
  POKICK*=.93;
  var POJIT=E*.05+POKICK*.042;   /* rad de tremor por particula: 0 em silencio */

  /* rotacao 3D lenta com PRECESSAO do eixo; a fala acelera o giro */
  var dt=POTPREV?Math.min(t-POTPREV,64):0;POTPREV=t;
  var fala=E>PO_DEADZONE?E-PO_DEADZONE:0;
  POROT+=dt*(fala*.00055+.000052+MD.swirl);
  var esp=t*.001;
  var yaw=PO_YAW0+POROT+Math.sin(esp*.21)*.05;
  var pit=PO_PIT0+Math.sin(esp*.147)*.11+Math.sin(POROT*1.3)*.05;
  var cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pit),sp=Math.sin(pit);

  /* raio quase fixo: pulso global le como CSS; o som deforma a SUPERFICIE */
  var R=M*.285*MD.contract*(1+E*.02+Math.sin(esp*.45)*.008);
  var PRAD=M*.13,PRAD2=PRAD*PRAD;

  /* ── camada 1: glow central — o bloom abre com o RMS ── */
  var gsz=R*3.1*(1+E*.22);
  ctx.globalCompositeOperation="lighter";
  ctx.globalAlpha=.15+E*.36+bass*.12;
  ctx.drawImage(POGLOW,CX-gsz/2,CY-gsz/2,gsz,gsz);
  ctx.globalAlpha=1;

  /* ── camada 2: halo de motes soltos (atras da casca) ── */
  for(var hI=0;hI<POHALO.length;hI++){
    var H=POHALO[hI];
    var hlon=H.lo+t*H.w,hlat=H.la+Math.sin(esp*H.f+H.p)*.05;
    var hcl=Math.cos(hlat);
    var hx=hcl*Math.cos(hlon)*H.r,hy=Math.sin(hlat)*H.r,hz=hcl*Math.sin(hlon)*H.r;
    var hx1=hx*cy-hz*sy,hz1=hx*sy+hz*cy;
    var hy1=hy*cp-hz1*sp,hz2=hy*sp+hz1*cp;
    var hsc=1/(3.1-hz2*.95),hdep=(hz2/H.r+1)/2;
    var hal=H.b*(.12+hdep*.5)*(.5+E*.9);
    if(hal<.03)continue;if(hal>1)hal=1;
    ctx.fillStyle=POAL[(hal*23)|0];
    var hs=H.s*hsc*1.2;
    ctx.fillRect(CX+hx1*R*2.6*hsc,CY+hy1*R*2.6*hsc,hs,hs);
  }

  /* ── camada 3: a casca ── */
  var piso=.92*MD.piso;
  for(var i=0;i<POP.length;i++){
    var P=POP[i],bd=BANDS[P.bd];
    /* flow-field: cada particula ANDA pela casca no seu proprio caminho.
       Com VOZ, entra o tremor individual: cada particula dança no seu ritmo
       e fase, mais forte na banda dela — sem padrao coletivo de onda. */
    var danca=POJIT*(.35+bd*1.3);
    var lon=P.lo+t*P.w*MD.drift+Math.sin(esp*P.f1+P.p1)*P.a1+Math.sin(t*.011*P.f2+P.p2)*danca;
    var lat=P.la+Math.sin(esp*P.f2+P.p2)*P.a2+Math.cos(t*.013*P.f1+P.p1)*danca*.8;
    var cl=Math.cos(lat),d0=cl*Math.cos(lon),d1=Math.sin(lat),d2=cl*Math.sin(lon);

    var rr=P.r*(1+bd*.10);
    var px=d0*rr,py=d1*rr,pz=d2*rr;
    var x1=px*cy-pz*sy,z1=px*sy+pz*cy;
    var y1=py*cp-z1*sp,z2=py*sp+z1*cp;
    var sc=1/(3.1-z2*.95),dep=(z2+1)/2;

    /* PROFUNDIDADE REAL: tras escuro e pequeno, frente clara e maior */
    var al=P.b*(.10+dep*dep*.85)*(piso+E*1.25+bd*.9);
    al*=1+Math.sin(esp*P.tf+P.tw)*MD.twk;   /* cintilacao individual */

    var gx=CX+x1*R*2.6*sc,gy=CY+y1*R*2.6*sc;
    /* po mexido pelo ponteiro: repulsao + redemoinho, assenta em ~1s */
    if(POPTR.on){
      var qx=gx-POPTR.x,qy=gy-POPTR.y,q2=qx*qx+qy*qy;
      if(q2<PRAD2){
        var qd=Math.sqrt(q2)||1,fall=1-qd/PRAD;
        var f=fall*fall*(.12+POPTR.sp*.4);
        P.wx+=(qx/qd)*f-(qy/qd)*f*.38;
        P.wy+=(qy/qd)*f+(qx/qd)*f*.38;
      }
    }
    if(P.wx||P.wy||P.ox||P.oy){
      P.ox=(P.ox+P.wx)*.94;P.oy=(P.oy+P.wy)*.94;
      P.wx*=.85;P.wy*=.85;
      var o2=P.ox*P.ox+P.oy*P.oy;
      if(o2<.03&&P.wx*P.wx+P.wy*P.wy<.01){P.ox=P.oy=P.wx=P.wy=0;}
      else{gx+=P.ox;gy+=P.oy;if(o2>3)al+=Math.min(.45,o2*.012);}
    }

    if(al<.04)continue;if(al>1)al=1;
    ctx.fillStyle=POAL[(al*23)|0];
    var s=P.s*POSZ*sc*1.35*(.5+dep*.9)*(1+bd*.3);
    ctx.fillRect(gx,gy,s,s);
  }
  ctx.globalCompositeOperation="source-over";
}


/* ================= ANTHROPIC =================
   A marca do Claude e um catavento de petalas irregulares — o proprio pessoal de
   design descreve como "asterisco, catavento ou ameba". Gerado por curva polar em
   vez de path fixo, pra cada petala poder respirar e reagir sozinha.
   Paleta da marca: creme #F0EEE6 com terracota #CC785C. */
var ANTP=null;
function buildAnth(){
  /* 11 petalas de comprimento e largura desiguais, como no logo */
  var L=[1.00,.62,.86,.54,.94,.70,1.00,.58,.80,.66,.90];
  var a=[];
  for(var i=0;i<11;i++){
    a.push({th:(i/11)*6.283+(Math.random()-.5)*.14,
            L:L[i]*(.92+Math.random()*.16),
            w:.19+Math.random()*.10,
            skew:.22+Math.random()*.16,
            ph:Math.random()*6.283,
            sp:.0006+Math.random()*.0011,
            bd:(i*2+1)%24});
  }
  return a;
}
function vAnth(ctx,w,h,t,E){
  if(!ANTP)ANTP=buildAnth();
  var CX=w/2,CY=h/2,M=Math.min(w,h);
  ctx.globalCompositeOperation="source-over";
  ctx.fillStyle="#F0EEE6";ctx.fillRect(0,0,w,h);

  var spin=t*.000042;
  var N=340,pts=[];
  for(var i=0;i<N;i++){
    var th=(i/N)*6.283;
    var r=.20;                                  /* corpo central */
    for(var k=0;k<ANTP.length;k++){
      var P=ANTP[k],bd=BANDS[P.bd];
      /* o catavento: a petala inclina conforme se afasta do centro */
      var d=th-(P.th+spin);
      while(d>3.1416)d-=6.283;while(d<-3.1416)d+=6.283;
      var sk=d*P.skew;
      var g=Math.exp(-(d*d)/(2*P.w*P.w));
      var life=1+Math.sin(t*P.sp*6.283+P.ph)*.07+bd*.46;
      r+=P.L*.78*g*life*(1+sk*.14);
    }
    /* irregularidade de mao: ruido lento sobre o contorno inteiro */
    r*=1+vn(Math.cos(th)*2.1,Math.sin(th)*2.1,t*.00013)*.055;
    r*=1+E*.05;
    pts.push([CX+Math.cos(th)*r*M*.34,CY+Math.sin(th)*r*M*.34]);
  }
  function path(){
    ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
    for(var k=1;k<N;k++){var p0=pts[k-1],p1=pts[k];
      ctx.quadraticCurveTo(p0[0],p0[1],(p0[0]+p1[0])/2,(p0[1]+p1[1])/2)}
    ctx.closePath();
  }
  /* sombra macia: da o volume de ameba sem contorno */
  ctx.save();
  ctx.shadowColor="rgba(150,86,60,.20)";ctx.shadowBlur=M*.05;ctx.shadowOffsetY=M*.012;
  path();
  var g2=ctx.createRadialGradient(CX-M*.06,CY-M*.07,M*.02,CX,CY,M*.40);
  g2.addColorStop(0,"#E08A66");
  g2.addColorStop(.55,"#CC785C");
  g2.addColorStop(1,"#B4614A");
  ctx.fillStyle=g2;ctx.fill();
  ctx.restore();

  /* nucleo mais quente, deslocado — a marca nao e simetrica */
  ctx.save();path();ctx.clip();
  var cg=ctx.createRadialGradient(CX-M*.045,CY-M*.055,0,CX-M*.045,CY-M*.055,M*.20);
  cg.addColorStop(0,"rgba(255,214,186,"+(.42+E*.34)+")");
  cg.addColorStop(1,"rgba(255,214,186,0)");
  ctx.fillStyle=cg;ctx.fillRect(CX-M*.5,CY-M*.5,M,M);
  ctx.restore();
}


/* ================= MALHA MOLDAVEL =================
   Antes era geometria congelada que so inflava o raio. Agora o deslocamento e
   recalculado por quadro: ruido evoluindo no tempo + um bico por banda de
   frequencia em cada vertice + onda de choque por silaba. A malha vira massa. */
var MLPREV=0,MLLAST=-9999,MLW=[];
function vMalha(ctx,w,h,t,E){
  var CX=w/2,CY=h/2,M=Math.min(w,h),R=M*.30;
  var dE=E-MLPREV;MLPREV=E;
  if(dE>.032&&t-MLLAST>150&&MLW.length<4){
    MLLAST=t;
    var ax=nrm([Math.random()*2-1,Math.random()*2-1,Math.random()*2-1]);
    MLW.push({t0:t,ax:ax,amp:.18+E*.40,dur:760});
  }
  for(var q=MLW.length-1;q>=0;q--)if(t-MLW[q].t0>MLW[q].dur)MLW.splice(q,1);

  ctx.globalCompositeOperation="source-over";
  var g0=ctx.createRadialGradient(CX,CY,0,CX,CY,Math.max(w,h)*.66);
  g0.addColorStop(0,BG());g0.addColorStop(1,"#03050a");
  ctx.fillStyle=g0;ctx.fillRect(0,0,w,h);

  var yaw=t*.00010,pit=Math.sin(t*.00006)*.30;
  var cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pit),sp=Math.sin(pit);
  var NW=MLW.length,WF=[],WA=[],WX=[];
  for(var k=0;k<NW;k++){
    var pr=(t-MLW[k].t0)/MLW[k].dur;
    WF.push(Math.cos(pr*3.1416));WA.push(MLW[k].amp*(1-pr)*(1-pr));WX.push(MLW[k].ax);
  }
  /* o deslocamento e a alma: ruido que anda no tempo + bico da banda + onda */
  function disp(d,bd){
    var n=vn(d[0]*1.9+t*.00022,d[1]*1.9,d[2]*1.9+t*.00016)*(.055+E*.20);
    n+=vn(d[0]*4.6,d[1]*4.6+t*.00031,d[2]*4.6)*(.022+E*.085);
    n+=bd*.20;
    for(var z=0;z<NW;z++){
      var ax=WX[z],dd=d[0]*ax[0]+d[1]*ax[1]+d[2]*ax[2]-WF[z];
      n+=Math.exp(-(dd*dd)*46)*WA[z];
    }
    return 1+n;
  }
  function P(d,r){
    var px=d[0]*r,py=d[1]*r,pz=d[2]*r;
    var x1=px*cy-pz*sy,z1=px*sy+pz*cy;
    var y1=py*cp-z1*sp,z2=py*sp+z1*cp;
    var sc=1/(3.0-z2*.9);
    return [CX+x1*R*2.6*sc,CY+y1*R*2.6*sc,z2,sc];
  }
  ctx.globalCompositeOperation="lighter";
  ctx.lineJoin="round";ctx.lineCap="round";

  var NLAT=15,NLON=24,SEG=58;
  /* paralelos */
  for(var la=1;la<NLAT;la++){
    var lat=-1.5708+la*(3.1416/NLAT),bd=BANDS[(la*3)%24],ds=0;
    ctx.beginPath();
    for(var i=0;i<=SEG;i++){
      var d=dir(lat,(i/SEG)*6.283),r=disp(d,bd),p=P(d,r);
      i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);ds+=(p[2]+1)/2;
    }
    var dp=ds/(SEG+1);
    ctx.strokeStyle=COL(Math.min(.95,(.05+dp*dp*.55)*(.5+bd*2.0)),dp*.4+bd*.6);
    ctx.lineWidth=(.55+dp*.9)*(1+bd*1.3);ctx.stroke();
  }
  /* meridianos */
  for(var lo=0;lo<NLON;lo++){
    var lon=(lo/NLON)*6.283,bd2=BANDS[(lo*5)%24],ds2=0,n2=40;
    ctx.beginPath();
    for(var j=0;j<=n2;j++){
      var la2=-1.5708+(j/n2)*3.1416;
      var d2=dir(la2,lon),r2=disp(d2,bd2),p2=P(d2,r2);
      j?ctx.lineTo(p2[0],p2[1]):ctx.moveTo(p2[0],p2[1]);ds2+=(p2[2]+1)/2;
    }
    var dp2=ds2/(n2+1);
    ctx.strokeStyle=COL(Math.min(.95,(.045+dp2*dp2*.5)*(.5+bd2*2.0)),dp2*.4+bd2*.6);
    ctx.lineWidth=(.5+dp2*.85)*(1+bd2*1.3);ctx.stroke();
  }
  /* vertices acesos nos cruzamentos que mais deslocaram */
  for(var la3=2;la3<NLAT;la3+=2){
    var lat3=-1.5708+la3*(3.1416/NLAT);
    for(var lo3=0;lo3<NLON;lo3+=2){
      var d3=dir(lat3,(lo3/NLON)*6.283),bd3=BANDS[(la3*3+lo3)%24];
      var r3=disp(d3,bd3),p3=P(d3,r3),dep=(p3[2]+1)/2;
      var ex=Math.max(0,r3-1);
      var al=(.05+dep*dep*.4)*(.3+ex*7);
      if(al<.03)continue;
      ctx.fillStyle=COL(Math.min(.95,al),.5+ex*4);
      var s=(.9+dep*1.5+ex*9)*p3[3];
      ctx.beginPath();ctx.arc(p3[0],p3[1],s,0,6.283);ctx.fill();
    }
  }
  var cg=ctx.createRadialGradient(CX,CY,0,CX,CY,R*.9);
  cg.addColorStop(0,"rgba(255,255,255,"+(.07+E*.22)+")");
  cg.addColorStop(.45,COL(.05+E*.10,1));cg.addColorStop(1,COL(0,1));
  ctx.fillStyle=cg;ctx.beginPath();ctx.arc(CX,CY,R*.9,0,6.283);ctx.fill();
  ctx.globalCompositeOperation="source-over";
}



/* ============================================================
   API publica
   ============================================================ */
function byId(id) { for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].id === id) return CATALOG[i]; return null; }

function Instance(host, def, opts) {
  this.def = def;
  this.opts = opts || {};
  this.host = host;
  this.running = false;
  this._raf = 0;
  this._scale = this.opts.scale || 1;
  var density = this.opts.density || 1;

  if (def.type === "dom") {
    var size = this.opts.size || Math.min(host.clientWidth || 240, host.clientHeight || 240) || 240;
    this.dom = siriMake(size);
    host.appendChild(this.dom);
    siriPaint(this.dom);
  } else {
    var cv = document.createElement("canvas");
    cv.style.display = "block";
    cv.style.width = "100%";
    cv.style.height = "100%";
    host.appendChild(cv);
    this.cv = cv;
    if (def.type === "gl") {
      this.G = makeGL(cv);
      if (!this.G) this.error = "WebGL2 indisponivel";
    } else {
      this.ctx = cv.getContext("2d", { alpha: false });
      this._resize();
      var self = this;
      this._onres = function () { self._resize(); };
      addEventListener("resize", this._onres);
    }
    if (def.g) this.S = def.g(density);
  }
}
Instance.prototype._resize = function () {
  if (!this.cv || !this.ctx) return;
  var d = Math.min(devicePixelRatio || 1, 2), r = this.cv.getBoundingClientRect();
  this.cv.width = Math.max(1, r.width * d);
  this.cv.height = Math.max(1, r.height * d);
  this.ctx.setTransform(d, 0, 0, d, 0, 0);
  this.w = r.width; this.h = r.height;
};
Instance.prototype._frame = function (t) {
  var E = readLevel(t), d = this.def;
  PALO = d.pal || this.opts.palette || null;
  if (d.type === "dom") siriUpdate(this.dom, t, E);
  else if (d.type === "gl") drawGL(this.G, this.cv, t, E, this.opts.quality || .75);
  else if (d.type === "viz") { if (this.w) d.draw(this.ctx, this.w, this.h, t, E); }
  else if (d.type === "orb") { if (this.w) renderOrb(this.ctx, this.w, this.h, t, E); }
  else if (this.w) render(this.ctx, this.w, this.h, this.S, t, E, this._scale);
  PALO = null;
};
Instance.prototype.start = function () {
  if (this.running) return this;
  this.running = true;
  var self = this;
  (function loop(t) { if (!self.running) return; self._frame(t); self._raf = requestAnimationFrame(loop); })(performance.now());
  return this;
};
Instance.prototype.stop = function () { this.running = false; cancelAnimationFrame(this._raf); return this; };
Instance.prototype.destroy = function () {
  this.stop();
  if (this._onres) removeEventListener("resize", this._onres);
  if (this.cv && this.cv.parentNode) this.cv.parentNode.removeChild(this.cv);
  if (this.dom && this.dom.parentNode) this.dom.parentNode.removeChild(this.dom);
};
Instance.prototype.resize = function () { this._resize(); return this; };

var API = {
  /* catalogo: [{id, name, type, desc}] */
  list: function () {
    return CATALOG.map(function (v) { return { id: v.id, name: v.n, type: v.type || "sphere", desc: v.d }; });
  },
  /* monta num elemento. opts: {palette, density, quality, size, scale} */
  mount: function (host, id, opts) {
    if (typeof host === "string") host = document.querySelector(host);
    var def = byId(id);
    if (!def) throw new Error("visualizador desconhecido: " + id);
    return new Instance(host, def, opts).start();
  },
  /* --- entrada de audio: escolha UMA --- */
  attachAnalyser: function (analyser) {
    _analyser = analyser;
    _freq = new Uint8Array(analyser.frequencyBinCount);
    SIM = false;
    return API;
  },
  attachMic: function (constraints) {
    return navigator.mediaDevices.getUserMedia(constraints || { audio: true }).then(function (stream) {
      var AC = window.AudioContext || window.webkitAudioContext;
      var ac = new AC(), src = ac.createMediaStreamSource(stream);
      var an = ac.createAnalyser();
      an.fftSize = 512; an.smoothingTimeConstant = .58;
      src.connect(an);
      API.attachAnalyser(an);
      return { context: ac, analyser: an, stream: stream };
    });
  },
  /* alimenta 24 bandas 0..1 manualmente (ex.: vindo do servidor por WebSocket) */
  setBands: function (arr) {
    _analyser = null; SIM = false;
    for (var i = 0; i < 24; i++) BANDS[i] += ((arr[i] || 0) - BANDS[i]) * .34;
    return API;
  },
  /* nivel unico 0..1, espalhado nas bandas — o mais simples de plugar */
  setLevel: function (v) {
    _analyser = null; SIM = false;
    v = Math.max(0, Math.min(1, v || 0));
    for (var i = 0; i < 24; i++) {
      var w = Math.exp(-Math.pow((i - 8) / 7, 2));
      BANDS[i] += (v * w - BANDS[i]) * .34;
    }
    return API;
  },
  /* voz simulada, para desenvolver sem microfone (o sandbox de iframe bloqueia getUserMedia) */
  simulate: function (on) { SIM = on !== false; if (SIM) _analyser = null; return API; },
  /* humor da esfera de po (assinatura visual por fase da conversa):
     calma | sentinela | escutando | pensando | falando */
  setMood: function (m) { POMOOD = POMOODP[m] ? m : "calma"; return API; },
  setPalette: function (p) { PAL = p; return API; },
  getBands: function () { return BANDS; }
};
return API;

});
