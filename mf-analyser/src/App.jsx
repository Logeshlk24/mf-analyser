import { useState, useEffect, useRef, useCallback } from "react";

// ─── CORS Proxy chain ──────────────────────────────────────────────────────────
const PROXIES = [
  (u) => u,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://proxy.cors.sh/${u}`,
];
async function fetchWithProxy(url) {
  let last = null;
  for (const mk of PROXIES) {
    try {
      const r = await fetch(mk(url), { headers: { Accept: "application/json", "x-requested-with": "XMLHttpRequest" } });
      if (!r.ok) continue;
      const txt = await r.text();
      if (!txt || txt.trim().startsWith("Host not") || txt.trim().startsWith("<")) continue;
      return JSON.parse(txt);
    } catch (e) { last = e; }
  }
  throw last ?? new Error("All fetch attempts failed");
}

// ─── Theme — DEFAULT LIGHT ─────────────────────────────────────────────────────
const T = {
  light: {
    bg:"#f4f7fb", surface:"#ffffff", card:"#ffffff", cardHover:"#f8faff",
    border:"#e2e8f0", borderLight:"#edf2f7",
    text:"#0f172a", textSub:"#475569", textMuted:"#94a3b8",
    accent:"#2563eb", green:"#16a34a", red:"#dc2626",
    input:"#f8faff", shadow:"0 2px 16px rgba(0,0,0,0.07)", chip:"#e8edf5",
    tooltip:"#1e293b", tooltipText:"#f8fafc",
  },
  dark: {
    bg:"#0a0e1a", surface:"#111827", card:"#1a2236", cardHover:"#1e2a40",
    border:"#2a3a52", borderLight:"#1e2d42",
    text:"#f0f4ff", textSub:"#8a9bc0", textMuted:"#4a5a78",
    accent:"#3b82f6", green:"#22c55e", red:"#ef4444",
    input:"#1a2236", shadow:"0 4px 24px rgba(0,0,0,0.4)", chip:"#1e2d42",
    tooltip:"#f0f4ff", tooltipText:"#0a0e1a",
  },
};

const COMPARE_COLORS = ["#2563eb","#16a34a","#d97706","#9333ea","#dc2626","#0891b2"];
const TABS   = ["NAV Chart","Returns","Annual","Risk Metrics","Best/Worst","Rolling Returns","Monthly Heatmap","SIP Calculator","Compare"];
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const POPULAR = [
  { name:"Parag Parikh Flexi Cap Fund – Direct – Growth", code:122639 },
  { name:"Quant Small Cap Fund – Direct – Growth",        code:120828 },
  { name:"HDFC Top 100 Fund – Direct – Growth",           code:125497 },
  { name:"Nippon India Nifty 50 Index – Direct – Growth", code:118989 },
  { name:"Mirae Asset Large Cap Fund – Direct – Growth",  code:118834 },
  { name:"Axis Bluechip Fund – Direct – Growth",          code:120503 },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────
function parseDate(str) { const [d,m,y]=str.split("-"); return new Date(`${y}-${m}-${d}`); }
function fmtDate(str) { const d=parseDate(str); return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}); }
const fmt  = (n,dec=2) => n==null||isNaN(n)?"--":Number(n).toFixed(dec);
const pct  = (n)       => n==null||isNaN(n)?"--":(n>0?"+":"")+Number(n).toFixed(2)+"%";
const fmtCr= (n)       => { if(n==null||isNaN(n)) return "--"; if(Math.abs(n)>=10000000) return "₹"+(n/10000000).toFixed(2)+"Cr"; if(Math.abs(n)>=100000) return "₹"+(n/100000).toFixed(2)+"L"; return "₹"+n.toFixed(0); };

function getNavAt(data, daysAgo) {
  const t=new Date(); t.setDate(t.getDate()-daysAgo);
  for(const d of data) if(parseDate(d.date)<=t) return parseFloat(d.nav);
  return null;
}
function cagrFn(s,e,y){ if(!s||!e||y<=0) return null; return (Math.pow(e/s,1/y)-1)*100; }

// ─── Analytics ────────────────────────────────────────────────────────────────
function computeStats(data) {
  if(!data?.length) return null;
  const latest=parseFloat(data[0].nav), latestDt=parseDate(data[0].date);
  const first=parseFloat(data[data.length-1].nav), firstDt=parseDate(data[data.length-1].date);
  const yrs=(latestDt-firstDt)/(1000*60*60*24*365.25);
  const cut3=new Date(); cut3.setFullYear(cut3.getFullYear()-3);
  const sl3=data.filter(d=>parseDate(d.date)>=cut3).map(d=>parseFloat(d.nav));
  let sharpe=null,sortino=null,stdDev=null;
  if(sl3.length>20){
    const rets=sl3.slice(0,-1).map((v,i)=>(v-sl3[i+1])/sl3[i+1]);
    const mean=rets.reduce((a,b)=>a+b,0)/rets.length;
    const variance=rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length;
    const std=Math.sqrt(variance);
    const downDev=Math.sqrt(rets.filter(r=>r<0).reduce((a,r)=>a+r*r,0)/rets.length||variance);
    stdDev=std*Math.sqrt(252)*100;
    sharpe=stdDev>0?((mean*252-0.06)/(std*Math.sqrt(252))):null;
    sortino=downDev>0?((mean*252-0.06)/(downDev*Math.sqrt(252))):null;
  }
  let peak=-Infinity,maxDD=0,ddDate=null;
  for(let i=data.length-1;i>=0;i--){
    const v=parseFloat(data[i].nav); if(v>peak) peak=v;
    const dd=(v-peak)/peak*100; if(dd<maxDD){maxDD=dd;ddDate=data[i].date;}
  }
  const n1y=getNavAt(data,365),n3y=getNavAt(data,1095),n5y=getNavAt(data,1825);
  return {
    latest,latestDate:data[0].date,inceptionDate:data[data.length-1].date,
    ret1d:(()=>{const n=getNavAt(data,2);return n?(latest-n)/n*100:null;})(),
    ret1y:n1y?cagrFn(n1y,latest,1):null, cagr3y:n3y?cagrFn(n3y,latest,3):null,
    cagr5y:n5y?cagrFn(n5y,latest,5):null, cagrAll:cagrFn(first,latest,yrs),
    sharpe,sortino,stdDev,maxDD,ddDate,totalYears:yrs,
  };
}

function computeTrailing(data) {
  const latest=parseFloat(data[0].nav),latestDt=parseDate(data[0].date);
  const first=parseFloat(data[data.length-1].nav);
  const yrs=(latestDt-parseDate(data[data.length-1].date))/(1000*60*60*24*365.25);
  const ytd=(()=>{ const j=new Date(`${latestDt.getFullYear()}-01-01`); for(const d of data) if(parseDate(d.date)<=j) return parseFloat(d.nav); return null; })();
  const row=(p,days,y)=>{ const n=days?getNavAt(data,days):null; return {period:p,ret:days?(n?(latest-n)/n*100:null):(ytd?(latest-ytd)/ytd*100:null),cagr:y&&n?cagrFn(n,latest,y):null}; };
  return [
    {period:"YTD",ret:ytd?(latest-ytd)/ytd*100:null,cagr:null},
    row("1D",2),row("1W",7),row("1M",30),row("3M",91),row("6M",182),
    row("1Y",365,1),row("3Y",1095,3),row("5Y",1825,5),row("7Y",2555,7),row("10Y",3650,10),
    {period:"Since Inception",ret:(latest-first)/first*100,cagr:cagrFn(first,latest,yrs)},
  ];
}

function computeCalYear(data) {
  const m={};
  data.forEach(d=>{ const y=parseDate(d.date).getFullYear(); if(!m[y]) m[y]={first:d,last:d}; else { if(parseDate(d.date)<parseDate(m[y].first.date)) m[y].first=d; if(parseDate(d.date)>parseDate(m[y].last.date)) m[y].last=d; } });
  return Object.keys(m).sort().map(y=>({ year:+y, ret:(parseFloat(m[y].last.nav)-parseFloat(m[y].first.nav))/parseFloat(m[y].first.nav)*100 }));
}

function computeAnnualWithVolatility(data) {
  const byYear={};
  data.forEach(d=>{ const y=parseDate(d.date).getFullYear(); if(!byYear[y]) byYear[y]=[]; byYear[y].push({date:d.date,nav:parseFloat(d.nav)}); });
  const cur=new Date().getFullYear();
  return Object.keys(byYear).sort().reverse().map(y=>{
    const items=byYear[y].sort((a,b)=>parseDate(a.date)-parseDate(b.date));
    const firstNav=items[0].nav, lastNav=items[items.length-1].nav;
    const ret=(lastNav-firstNav)/firstNav*100;
    const dailyRets=items.slice(1).map((v,i)=>(v.nav-items[i].nav)/items[i].nav);
    let vol=null;
    if(dailyRets.length>5){
      const mean=dailyRets.reduce((a,b)=>a+b,0)/dailyRets.length;
      const variance=dailyRets.reduce((a,b)=>a+(b-mean)**2,0)/dailyRets.length;
      vol=Math.sqrt(variance)*Math.sqrt(252)*100;
    }
    return {year:+y,ret,vol,isYTD:+y===cur};
  });
}

function computeMonthly(data) {
  const m={};
  data.forEach(d=>{ const dt=parseDate(d.date),y=dt.getFullYear(),mo=dt.getMonth(); if(!m[y]) m[y]={}; if(!m[y][mo]) m[y][mo]={first:d,last:d}; else { if(dt<parseDate(m[y][mo].first.date)) m[y][mo].first=d; if(dt>parseDate(m[y][mo].last.date)) m[y][mo].last=d; } });
  const res={};
  Object.keys(m).forEach(y=>{ res[y]={}; Object.keys(m[y]).forEach(mo=>{ res[y][mo]=(parseFloat(m[y][mo].last.nav)-parseFloat(m[y][mo].first.nav))/parseFloat(m[y][mo].first.nav)*100; }); });
  return res;
}

function computeRolling(data,years) {
  const days=Math.round(years*365.25);
  // data comes in desc order (latest first); sort asc for rolling calc
  const sorted=[...data].sort((a,b)=>parseDate(a.date)-parseDate(b.date));
  return sorted.reduce((acc,d,i)=>{
    const end=parseDate(d.date),tgt=new Date(end); tgt.setDate(tgt.getDate()-days);
    let si=null; for(let j=i-1;j>=0;j--){ if(parseDate(sorted[j].date)<=tgt){si=j;break;} }
    if(si!==null){ const y=(end-parseDate(sorted[si].date))/(1000*60*60*24*365.25); if(y>0) acc.push({date:d.date,cagr:(Math.pow(parseFloat(d.nav)/parseFloat(sorted[si].nav),1/y)-1)*100}); }
    return acc;
  },[]);
}

function computeBestWorst(data) {
  const sorted=[...data].sort((a,b)=>parseDate(a.date)-parseDate(b.date));
  const res={};
  for(const [k,days] of Object.entries({week:7,month:30,quarter:91,year:365})){
    let best=null,worst=null;
    sorted.forEach((d,i)=>{ const end=parseDate(d.date),tgt=new Date(end); tgt.setDate(tgt.getDate()-days); let si=null; for(let j=i-1;j>=0;j--){if(parseDate(sorted[j].date)<=tgt){si=j;break;}} if(si!==null){ const r=(parseFloat(d.nav)-parseFloat(sorted[si].nav))/parseFloat(sorted[si].nav)*100; if(!best||r>best.ret) best={ret:r,begin:sorted[si].date,end:d.date}; if(!worst||r<worst.ret) worst={ret:r,begin:sorted[si].date,end:d.date}; } });
    res[k]={best,worst};
  }
  return res;
}

function rebaseNavSeries(funds) {
  if(!funds.length) return null;
  const allDates=funds.map(f=>new Set(f.data.map(d=>d.date)));
  const common=[...allDates[0]].filter(d=>allDates.every(s=>s.has(d))).sort();
  if(common.length<2) return null;
  return { series:funds.map((f,i)=>{
    const baseNav=parseFloat(f.data.find(d=>d.date===common[0])?.nav??f.data[f.data.length-1].nav);
    return { name:f.meta?.scheme_name??"Fund "+(i+1), color:COMPARE_COLORS[i%COMPARE_COLORS.length],
      points:common.map(date=>({date,val:parseFloat(f.data.find(d=>d.date===date)?.nav??baseNav)/baseNav*100})) };
  }), startDate:common[0], endDate:common[common.length-1] };
}

// ─── Shared SVG tooltip hook ───────────────────────────────────────────────────
function useChartTooltip() {
  const [tip,setTip]=useState(null); // {x,y,lines:[{label,val,color?}]}
  const ref=useRef(null);
  return {tip,setTip,ref};
}

function Tooltip({tip,t}){
  if(!tip) return null;
  return (
    <div style={{position:"absolute",left:tip.x,top:tip.y,transform:"translate(-50%,-100%) translateY(-10px)",backgroundColor:t.tooltip,color:t.tooltipText,borderRadius:8,padding:"8px 12px",fontSize:12,pointerEvents:"none",zIndex:50,boxShadow:"0 4px 16px rgba(0,0,0,0.2)",whiteSpace:"nowrap"}}>
      <div style={{fontWeight:700,marginBottom:4,fontSize:11,opacity:0.8}}>{tip.date}</div>
      {tip.lines.map((l,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:6}}>
          {l.color&&<span style={{width:8,height:8,borderRadius:"50%",backgroundColor:l.color,flexShrink:0}}/>}
          <span style={{opacity:0.75}}>{l.label}:</span>
          <span style={{fontWeight:700}}>{l.val}</span>
        </div>
      ))}
      <div style={{position:"absolute",bottom:-5,left:"50%",transform:"translateX(-50%)",width:10,height:10,backgroundColor:t.tooltip,clipPath:"polygon(0 0,100% 0,50% 100%)"}}/>
    </div>
  );
}

// ─── NAV Line Chart with tooltip ──────────────────────────────────────────────
function LineChart({data,t,range}){
  const {tip,setTip,ref}=useChartTooltip();
  const W=900,H=300;
  if(!data?.length) return null;

  // data is newest-first from API — sort ascending for correct left→right display
  const now=new Date(),cut=new Date();
  if(range==="1Y"){cut.setFullYear(now.getFullYear()-1);}
  else if(range==="3Y"){cut.setFullYear(now.getFullYear()-3);}
  else if(range==="5Y"){cut.setFullYear(now.getFullYear()-5);}
  else if(range==="YTD"){cut.setMonth(0,1);}
  else{cut.setFullYear(2000);}

  // Filter then sort ascending (oldest first = left side of chart)
  const fd=[...data].filter(d=>parseDate(d.date)>=cut).sort((a,b)=>parseDate(a.date)-parseDate(b.date));
  if(fd.length<2) return <div style={{color:t.textMuted,textAlign:"center",paddingTop:60}}>Not enough data for this range</div>;

  const navs=fd.map(d=>parseFloat(d.nav)),minV=Math.min(...navs),maxV=Math.max(...navs);
  const pad={t:20,b:48,l:72,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
  const xf=i=>pad.l+(i/(fd.length-1))*W2;
  const yf=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
  const pts=fd.map((d,i)=>`${xf(i)},${yf(parseFloat(d.nav))}`).join(" ");
  const isUp=parseFloat(fd[fd.length-1].nav)>=parseFloat(fd[0].nav);
  const col=isUp?t.green:t.red;
  const gid="g"+Math.random().toString(36).slice(2,7);

  const step=Math.max(1,Math.floor(fd.length/7));
  const xL=[];
  for(let i=0;i<fd.length;i+=step){const dt=parseDate(fd[i].date);xL.push({x:xf(i),label:`${dt.getMonth()+1}/${String(dt.getFullYear()).slice(2)}`});}

  const handleMouse=useCallback((e)=>{
    const svg=e.currentTarget; const rect=svg.getBoundingClientRect();
    const mx=e.clientX-rect.left; const svgX=(mx/rect.width)*W;
    const idx=Math.max(0,Math.min(fd.length-1,Math.round((svgX-pad.l)/W2*(fd.length-1))));
    if(idx<0||idx>=fd.length) return;
    const d=fd[idx]; const px=xf(idx),py=yf(parseFloat(d.nav));
    setTip({x:(px/W)*rect.width+rect.left-rect.left,y:(py/H)*rect.height,date:fmtDate(d.date),lines:[{label:"NAV",val:`₹${fmt(parseFloat(d.nav))}`}]});
  },[fd]);

  return (
    <div ref={ref} style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair"}}
        onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
        <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.22"/><stop offset="100%" stopColor={col} stopOpacity="0"/></linearGradient></defs>
        {[0,0.25,0.5,0.75,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-8} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}</text></g>);})}
        <polygon points={`${pad.l},${pad.t+H2} ${pts} ${pad.l+W2},${pad.t+H2}`} fill={`url(#${gid})`}/>
        <polyline points={pts} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
        {/* Hover crosshair dot — rendered via tip */}
        {tip&&(()=>{const idx=Math.max(0,Math.min(fd.length-1,Math.round((tip._svgX??0-pad.l)/W2*(fd.length-1))));return null;})()}
        {xL.map((l,i)=><text key={i} x={l.x} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
      </svg>
      {tip&&<Tooltip tip={{...tip,x:tip.x,y:tip.y}} t={t}/>}
    </div>
  );
}

// ─── Rolling Returns Chart with tooltip ───────────────────────────────────────
function RollingChart({data,t,color}){
  const {tip,setTip}=useChartTooltip();
  const W=900,H=300;
  const col=color??t.accent;
  if(!data?.length) return <div style={{color:t.textMuted,padding:"60px",textAlign:"center"}}>Not enough data for this rolling window</div>;
  const vals=data.map(d=>d.cagr),minV=Math.min(...vals,0),maxV=Math.max(...vals);
  const pad={t:20,b:48,l:60,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
  const xf=i=>pad.l+(i/(data.length-1))*W2,yf=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
  const pts=data.map((d,i)=>`${xf(i)},${yf(d.cagr)}`).join(" ");
  const zY=yf(0);
  const step=Math.max(1,Math.floor(data.length/7));
  const xL=[]; for(let i=0;i<data.length;i+=step){xL.push({x:xf(i),label:parseDate(data[i].date).getFullYear().toString()});}

  const handleMouse=useCallback((e)=>{
    const svg=e.currentTarget,rect=svg.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(data.length-1,Math.round((svgX-pad.l)/W2*(data.length-1))));
    const d=data[idx];
    setTip({x:(xf(idx)/W)*rect.width,y:(yf(d.cagr)/H)*rect.height,date:fmtDate(d.date),lines:[{label:"CAGR",val:pct(d.cagr),color:col}]});
  },[data]);

  return (
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair"}} onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
        {[0,0.25,0.5,0.75,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}%</text></g>);})}
        <line x1={pad.l} x2={pad.l+W2} y1={zY} y2={zY} stroke={t.textMuted} strokeWidth="1"/>
        <polyline points={pts} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round"/>
        {xL.map((l,i)=><text key={i} x={l.x} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Annual Bar Chart with tooltip ────────────────────────────────────────────
function AnnualBarChart({data,t}){
  const {tip,setTip}=useChartTooltip();
  const W=900,H=320;
  if(!data?.length) return null;
  const items=[...data].reverse(); // ascending for chart
  const maxAbs=Math.max(...items.map(d=>Math.abs(d.ret)),1);
  const pad={t:30,b:48,l:50,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
  const zY=pad.t+H2/2;
  const barW=Math.max(8,Math.min(44,(W2/items.length)-6));

  const handleMouse=useCallback((e,d)=>{
    const svg=e.currentTarget.closest("svg"),rect=svg.getBoundingClientRect();
    const cx=pad.l+(items.indexOf(d)+0.5)*(W2/items.length);
    const col=d.ret>=0?t.green:t.red;
    setTip({x:(cx/W)*rect.width,y:(zY/H)*rect.height,date:String(d.year)+(d.isYTD?" (YTD)":""),lines:[{label:"Return",val:pct(d.ret),color:col},{label:"Volatility",val:d.vol!=null?fmt(d.vol)+"%":"--"}]});
  },[items,t]);

  return (
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"default"}} onMouseLeave={()=>setTip(null)}>
        {[-30,-20,-10,0,10,20,30,40,50,60].map((v,i)=>{
          const yp=zY-(v/maxAbs)*(H2/2); if(yp<pad.t-2||yp>pad.t+H2+2) return null;
          return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth={v===0?1:0.5} strokeDasharray={v===0?"none":"3,3"}/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="10" fill={t.textMuted}>{v}%</text></g>);
        })}
        {items.map((d,i)=>{
          const cx=pad.l+(i+0.5)*(W2/items.length);
          const barH=Math.abs(d.ret)/maxAbs*(H2/2);
          const y=d.ret>=0?zY-barH:zY;
          const col=d.ret>=0?t.green:t.red;
          return(
            <g key={d.year} onMouseEnter={e=>handleMouse(e,d)}>
              <rect x={cx-barW/2} y={y} width={barW} height={Math.max(barH,1)} fill={col} opacity="0.85" rx="2" style={{cursor:"pointer"}}/>
              <text x={cx} y={H-10} textAnchor="middle" fontSize="10" fill={t.textMuted}>{d.year}</text>
            </g>
          );
        })}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Compare NAV Chart (multi-line) with tooltip ──────────────────────────────
function CompareChart({series,t}){
  const {tip,setTip}=useChartTooltip();
  const W=900,H=340;
  if(!series?.length) return null;
  const allPts=series.flatMap(s=>s.points.map(p=>p.val));
  const minV=Math.min(...allPts),maxV=Math.max(...allPts);
  const pad={t:20,b:48,l:68,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
  const n=series[0]?.points?.length??0; if(n<2) return null;
  const xf=i=>pad.l+(i/(n-1))*W2, yf=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
  const step=Math.max(1,Math.floor(n/8));
  const xL=[]; for(let i=0;i<n;i+=step){const dt=parseDate(series[0].points[i].date);xL.push({x:xf(i),label:`${dt.getMonth()+1}/${String(dt.getFullYear()).slice(2)}`});}

  const handleMouse=useCallback((e)=>{
    const svg=e.currentTarget,rect=svg.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(n-1,Math.round((svgX-pad.l)/W2*(n-1))));
    const d0=series[0].points[idx];
    const avgY=series.reduce((s2,s)=>s2+yf(s.points[idx]?.val??minV),0)/series.length;
    setTip({x:(xf(idx)/W)*rect.width,y:(avgY/H)*rect.height,date:fmtDate(d0.date),
      lines:series.map(s=>({label:s.name.split("–")[0].trim().slice(0,22),val:fmt(s.points[idx]?.val??0),color:s.color}))});
  },[series,n]);

  return (
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair"}} onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
        {[0,0.2,0.4,0.6,0.8,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{Math.round(v)}</text></g>);})}
        {series.map(s=>{const pts=s.points.map((p,i)=>`${xf(i)},${yf(p.val)}`).join(" ");return<polyline key={s.name} points={pts} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>;  })}
        {xL.map((l,i)=><text key={i} x={l.x} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Compare Rolling Chart (multi-line) with tooltip ──────────────────────────
function CompareRollingChart({series,t}){
  const {tip,setTip}=useChartTooltip();
  const W=900,H=300;
  if(!series?.length||!series[0]?.points?.length) return <div style={{color:t.textMuted,padding:40,textAlign:"center"}}>Not enough data</div>;
  const allPts=series.flatMap(s=>s.points.map(p=>p.val));
  const minV=Math.min(...allPts,0),maxV=Math.max(...allPts);
  const pad={t:20,b:48,l:60,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
  const zY=pad.t+(1-(0-minV)/(maxV-minV||1))*H2;

  const handleMouse=useCallback((e)=>{
    const svg=e.currentTarget,rect=svg.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    // use longest series as reference
    const ref=series.reduce((a,b)=>a.points.length>b.points.length?a:b);
    const n=ref.points.length; if(!n) return;
    const xf2=i=>pad.l+(i/(n-1))*W2;
    const idx=Math.max(0,Math.min(n-1,Math.round((svgX-pad.l)/W2*(n-1))));
    setTip({x:(xf2(idx)/W)*rect.width,y:(zY/H)*rect.height,date:fmtDate(ref.points[idx].date),
      lines:series.map(s=>{const p=s.points[Math.min(idx,s.points.length-1)];return{label:s.name.split("–")[0].trim().slice(0,22),val:pct(p?.val??0),color:s.color};})});
  },[series,zY]);

  return (
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair"}} onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
        {[0,0.25,0.5,0.75,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}%</text></g>);})}
        <line x1={pad.l} x2={pad.l+W2} y1={zY} y2={zY} stroke={t.textMuted} strokeWidth="1"/>
        {series.map(s=>{
          const n=s.points.length; if(n<2) return null;
          const xf2=i=>pad.l+(i/(n-1))*W2,yf2=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
          const step2=Math.max(1,Math.floor(n/7));
          return(
            <g key={s.name}>
              <polyline points={s.points.map((p,i)=>`${xf2(i)},${yf2(p.val)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"/>
              {[...Array(Math.ceil(n/step2))].map((_,k)=>{const i2=Math.min(k*step2,n-1);const dt=parseDate(s.points[i2].date);return<text key={i2} x={xf2(i2)} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{dt.getFullYear()}</text>;})}
            </g>
          );
        })}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [isDark,setIsDark]            = useState(false); // ← DEFAULT LIGHT
  const t                             = T[isDark?"dark":"light"];
  const [query,setQuery]              = useState("");
  const [suggestions,setSuggestions]  = useState([]);
  const [searching,setSearching]      = useState(false);
  const [fund,setFund]                = useState(null);
  const [loading,setLoading]          = useState(false);
  const [error,setError]              = useState(null);
  const [activeTab,setActiveTab]      = useState("NAV Chart");
  const [navRange,setNavRange]        = useState("ALL");
  const [rollingYears,setRollingYears]= useState(3);
  const [rollingData,setRollingData]  = useState(null);
  const [sip,setSip]                  = useState({lumpsum:100000,monthly:10000,duration:5,expense:1.5});
  const [sipResult,setSipResult]      = useState(null);
  const [cmpFunds,setCmpFunds]        = useState([]);
  const [cmpQuery,setCmpQuery]        = useState("");
  const [cmpSugg,setCmpSugg]          = useState([]);
  const [cmpLoading,setCmpLoading]    = useState(false);
  const [cmpTab,setCmpTab]            = useState("NAV");
  const [cmpRollingYrs,setCmpRollingYrs]=useState(3);
  const debRef=useRef(null),cmpDebRef=useRef(null);
  const searchRef=useRef(null),cmpSearchRef=useRef(null);

  useEffect(()=>{
    const h=e=>{ if(searchRef.current&&!searchRef.current.contains(e.target)) setSuggestions([]); if(cmpSearchRef.current&&!cmpSearchRef.current.contains(e.target)) setCmpSugg([]); };
    document.addEventListener("mousedown",h); return()=>document.removeEventListener("mousedown",h);
  },[]);

  const handleSearch=val=>{
    setQuery(val); clearTimeout(debRef.current);
    if(!val.trim()){setSuggestions([]);return;}
    debRef.current=setTimeout(async()=>{ setSearching(true); try{const j=await fetchWithProxy(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(val)}`);setSuggestions((Array.isArray(j)?j:[]).slice(0,12));}catch{setSuggestions([]);} setSearching(false); },380);
  };

  const loadFund=async code=>{
    setLoading(true);setError(null);setSuggestions([]);setQuery("");setSipResult(null);
    try{
      const j=await fetchWithProxy(`https://api.mfapi.in/mf/${code}`);
      if(!j?.data?.length) throw new Error("No NAV data");
      setFund(j);setActiveTab("NAV Chart");setNavRange("ALL");
      setCmpFunds([j]);
    }catch(e){setError(e.message||"Failed to load fund");}
    setLoading(false);
  };

  const handleCmpSearch=val=>{
    setCmpQuery(val); clearTimeout(cmpDebRef.current);
    if(!val.trim()){setCmpSugg([]);return;}
    cmpDebRef.current=setTimeout(async()=>{ try{const j=await fetchWithProxy(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(val)}`);setCmpSugg((Array.isArray(j)?j:[]).slice(0,10));}catch{setCmpSugg([]);} },380);
  };

  const addCmpFund=async code=>{
    if(cmpFunds.length>=6) return; setCmpLoading(true);setCmpSugg([]);setCmpQuery("");
    try{const j=await fetchWithProxy(`https://api.mfapi.in/mf/${code}`); if(j?.data?.length) setCmpFunds(p=>[...p,j]);}catch{}
    setCmpLoading(false);
  };

  useEffect(()=>{ if(!fund) return; setRollingData(computeRolling(fund.data,rollingYears)); },[fund,rollingYears]);

  const calcSIP=()=>{
    const{lumpsum,monthly,duration,expense}=sip;
    const base=stats?.cagr5y??12; const adj=Math.max(0,base-expense);
    const r=adj/100/12,n=duration*12;
    const sipFV=r>0?monthly*((Math.pow(1+r,n)-1)/r)*(1+r):monthly*n;
    const lsFV=lumpsum*Math.pow(1+adj/100,duration);
    const total=sipFV+lsFV,inv=lumpsum+monthly*n;
    setSipResult({sipFV,lsFV,total,invested:inv,gain:total-inv,cagr:adj});
  };

  const stats     = fund?computeStats(fund.data):null;
  const calYear   = fund?computeCalYear(fund.data):[];
  const trailing  = fund?computeTrailing(fund.data):[];
  const monthly   = fund?computeMonthly(fund.data):{};
  const bestWorst = fund?computeBestWorst(fund.data):null;
  const annualVol = fund?computeAnnualWithVolatility(fund.data):[];
  const cmpRebased= cmpFunds.length>=2?rebaseNavSeries(cmpFunds):null;
  const cmpRolling= cmpFunds.map((f,i)=>({name:f.meta?.scheme_name,color:COMPARE_COLORS[i%COMPARE_COLORS.length],points:computeRolling(f.data,cmpRollingYrs)}));
  const cmpStats  = cmpFunds.map(f=>computeStats(f.data));
  const cmpBW     = cmpFunds.map(f=>computeBestWorst(f.data));

  // ── Styles ──────────────────────────────────────────────────────────────────
  const s={
    app:    {minHeight:"100vh",backgroundColor:t.bg,color:t.text,fontFamily:"'DM Sans','Segoe UI',sans-serif"},
    nav:    {backgroundColor:t.surface,borderBottom:`1px solid ${t.border}`,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,position:"sticky",top:0,zIndex:100,boxShadow:t.shadow},
    logo:   {display:"flex",alignItems:"center",gap:10,fontWeight:800,fontSize:20,color:t.text,cursor:"pointer",userSelect:"none"},
    logoBox:{width:36,height:36,background:`linear-gradient(135deg,${t.accent},#6366f1)`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18},
    swrap:  {position:"relative",flex:1,maxWidth:520,margin:"0 28px"},
    sinput: {width:"100%",padding:"9px 16px 9px 40px",borderRadius:10,border:`1.5px solid ${t.border}`,backgroundColor:t.input,color:t.text,fontSize:14,outline:"none",boxSizing:"border-box"},
    sicon:  {position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:t.textMuted,fontSize:15,pointerEvents:"none"},
    drop:   {position:"absolute",top:"calc(100% + 6px)",left:0,right:0,backgroundColor:t.surface,border:`1px solid ${t.border}`,borderRadius:12,zIndex:300,overflow:"hidden",boxShadow:t.shadow,maxHeight:360,overflowY:"auto"},
    dropI:  {padding:"11px 16px",cursor:"pointer",fontSize:13,borderBottom:`1px solid ${t.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"},
    tBtn:   {padding:"7px 16px",borderRadius:8,border:`1px solid ${t.border}`,backgroundColor:t.chip,color:t.text,cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap"},
    cont:   {maxWidth:1140,margin:"0 auto",padding:"0 20px 80px"},
    card:   {backgroundColor:t.card,border:`1px solid ${t.border}`,borderRadius:14,padding:"20px 22px",marginBottom:20},
    ctitle: {fontSize:15,fontWeight:700,color:t.accent,marginBottom:16},
    sBar:   {display:"flex",flexWrap:"wrap",gap:1,backgroundColor:t.border,borderRadius:14,overflow:"hidden",marginBottom:20,border:`1px solid ${t.border}`},
    sCell:  {flex:"1 1 110px",padding:"14px 14px",backgroundColor:t.card,textAlign:"center"},
    sLbl:   {fontSize:9,color:t.textMuted,textTransform:"uppercase",letterSpacing:"0.9px",marginBottom:5},
    sVal:   {fontSize:17,fontWeight:700,lineHeight:1},
    tabRow: {display:"flex",borderBottom:`1px solid ${t.border}`,marginBottom:24,overflowX:"auto",gap:0},
    tab:  a=>({padding:"11px 18px",cursor:"pointer",fontSize:13,fontWeight:a?600:400,color:a?t.accent:t.textSub,borderBottom:a?`2.5px solid ${t.accent}`:"2.5px solid transparent",whiteSpace:"nowrap",userSelect:"none",backgroundColor:"transparent"}),
    table:  {width:"100%",borderCollapse:"collapse",fontSize:13},
    th:     {padding:"9px 12px",textAlign:"right",color:t.textMuted,fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:"0.6px",borderBottom:`1px solid ${t.border}`},
    thL:    {padding:"9px 12px",textAlign:"left",color:t.textMuted,fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:"0.6px",borderBottom:`1px solid ${t.border}`},
    td:     {padding:"9px 12px",textAlign:"right",borderBottom:`1px solid ${t.borderLight}`,fontSize:13},
    tdL:    {padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${t.borderLight}`,fontWeight:500,fontSize:13},
    chip:   {display:"inline-block",padding:"7px 14px",backgroundColor:t.chip,borderRadius:20,fontSize:12,cursor:"pointer",border:`1px solid ${t.border}`,margin:"3px"},
    mBox:   {flex:"1 1 150px",backgroundColor:t.bg,border:`1px solid ${t.border}`,borderRadius:12,padding:"14px 16px"},
    mLbl:   {fontSize:11,color:t.textMuted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.6px"},
    mVal:   {fontSize:21,fontWeight:700},
  };
  const cv=v=>({color:v==null||isNaN(v)?t.textMuted:v>=0?t.green:t.red,fontWeight:600});

  const Dropdown=({items,onSelect})=>items.length>0?(
    <div style={s.drop}>{items.map(su=>(
      <div key={su.schemeCode} style={s.dropI}
        onMouseEnter={e=>e.currentTarget.style.backgroundColor=t.chip}
        onMouseLeave={e=>e.currentTarget.style.backgroundColor="transparent"}
        onClick={()=>onSelect(su.schemeCode)}>
        <span style={{flex:1,paddingRight:8,lineHeight:1.4}}>{su.schemeName}</span>
        <span style={{color:t.textMuted,fontSize:11,whiteSpace:"nowrap"}}>#{su.schemeCode}</span>
      </div>
    ))}</div>
  ):null;

  const RangeBtns=({ranges,active,onSet})=>(
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {ranges.map(r=>(
        <button key={r} onClick={()=>onSet(r)} style={{padding:"5px 13px",borderRadius:7,border:`1px solid ${active===r?t.accent:t.border}`,backgroundColor:active===r?t.accent:t.chip,color:active===r?"#fff":t.text,cursor:"pointer",fontSize:12,fontWeight:active===r?600:400}}>{r}</button>
      ))}
    </div>
  );

  // ── HOME ────────────────────────────────────────────────────────────────────
  if(!fund&&!loading) return (
    <div style={s.app}>
      <nav style={s.nav}>
        <div style={s.logo}><div style={s.logoBox}>📈</div>MFAnalyser</div>
        <button style={s.tBtn} onClick={()=>setIsDark(p=>!p)}>{isDark?"☀️ Light":"🌙 Dark"}</button>
      </nav>
      <div style={{textAlign:"center",padding:"80px 24px 60px",maxWidth:680,margin:"0 auto"}}>
        <div style={{fontSize:60,marginBottom:20}}>📊</div>
        <h1 style={{fontSize:"clamp(28px,5vw,52px)",fontWeight:800,letterSpacing:"-1.5px",lineHeight:1.1,marginBottom:16}}>Analyse any Indian<br/>Mutual Fund</h1>
        <p style={{color:t.textSub,fontSize:16,lineHeight:1.7,marginBottom:40}}>Live NAV · Rolling CAGRs · Risk Metrics · Annual Analysis · Fund Comparison · SIP Calculator<br/>All from public AMFI data — free, no login required.</p>
        <div ref={searchRef} style={{position:"relative",marginBottom:28}}>
          <span style={{position:"absolute",left:18,top:"50%",transform:"translateY(-50%)",fontSize:18,color:t.textMuted,pointerEvents:"none"}}>🔍</span>
          <input style={{width:"100%",padding:"15px 20px 15px 50px",borderRadius:14,border:`1.5px solid ${t.border}`,backgroundColor:t.input,color:t.text,fontSize:16,outline:"none",boxSizing:"border-box",boxShadow:t.shadow}} placeholder="Search e.g. Parag Parikh, HDFC, Nifty 50…" value={query} onChange={e=>handleSearch(e.target.value)}/>
          {searching&&<div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",color:t.textMuted,fontSize:12}}>Searching…</div>}
          <Dropdown items={suggestions} onSelect={loadFund}/>
        </div>
        <div>
          <div style={{fontSize:11,color:t.textMuted,marginBottom:10,letterSpacing:1.2,textTransform:"uppercase"}}>✦ Popular Funds</div>
          {POPULAR.map(p=>(
            <span key={p.code} style={s.chip} onClick={()=>loadFund(p.code)}
              onMouseEnter={e=>{e.currentTarget.style.backgroundColor=t.accent;e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor=t.accent;}}
              onMouseLeave={e=>{e.currentTarget.style.backgroundColor=t.chip;e.currentTarget.style.color=t.text;e.currentTarget.style.borderColor=t.border;}}>
              {p.name.split("–")[0].trim()} <span style={{color:t.textMuted,fontSize:10}}>#{p.code}</span>
            </span>
          ))}
        </div>
        {error&&<div style={{marginTop:32,backgroundColor:t.card,border:`1px solid ${t.red}`,borderRadius:12,padding:20,textAlign:"left"}}><div style={{color:t.red,fontWeight:700,marginBottom:8}}>⚠️ Error</div><div style={{color:t.textSub,fontSize:13,lineHeight:1.6}}>{error}</div></div>}
        <div style={{marginTop:60,fontSize:12,color:t.textMuted,lineHeight:1.8}}>Data sourced from <strong>AMFI India</strong> via mfapi.in · For informational purposes only<br/>Not investment advice · Past performance does not guarantee future results</div>
      </div>
    </div>
  );

  if(loading) return (
    <div style={{...s.app,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>⏳</div>
      <div style={{fontSize:16,color:t.textSub}}>Loading fund data…</div>
      <div style={{fontSize:12,color:t.textMuted}}>Fetching from AMFI · please wait</div>
    </div>
  );

  // ── FUND DETAIL ─────────────────────────────────────────────────────────────
  return (
    <div style={s.app}>
      <nav style={s.nav}>
        <div style={s.logo} onClick={()=>{setFund(null);setError(null);}}>
          <div style={s.logoBox}>📈</div>
          <span style={{fontSize:14,fontWeight:600,color:t.textMuted}}>MFAnalyser</span>
        </div>
        <div ref={searchRef} style={s.swrap}>
          <span style={s.sicon}>🔍</span>
          <input style={s.sinput} placeholder="Search another fund…" value={query} onChange={e=>handleSearch(e.target.value)}/>
          <Dropdown items={suggestions} onSelect={loadFund}/>
        </div>
        <button style={s.tBtn} onClick={()=>setIsDark(p=>!p)}>{isDark?"☀️ Light":"🌙 Dark"}</button>
      </nav>

      <div style={s.cont}>
        {/* Fund Header */}
        <div style={{padding:"22px 0 14px"}}>
          <div style={{fontSize:11,color:t.textMuted,textTransform:"uppercase",letterSpacing:1.1,marginBottom:4}}>{fund.meta?.fund_house}</div>
          <h2 style={{fontSize:"clamp(14px,2vw,20px)",fontWeight:700,lineHeight:1.35,marginBottom:10}}>{fund.meta?.scheme_name}</h2>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[fund.meta?.scheme_category,fund.meta?.scheme_type].filter(Boolean).map(tag=>(
              <span key={tag} style={{...s.chip,fontSize:11,padding:"4px 11px",cursor:"default"}}>{tag}</span>
            ))}
            {stats&&<span style={{...s.chip,fontSize:11,padding:"4px 11px",cursor:"default",color:t.textMuted}}>Since {stats.inceptionDate}</span>}
          </div>
        </div>

        {/* Stats Bar */}
        {stats&&(
          <div style={s.sBar}>
            {[
              {label:"Latest NAV",     val:`₹${fmt(stats.latest)}`,      color:t.text},
              {label:"1D Return",      val:pct(stats.ret1d),             color:(stats.ret1d??0)>=0?t.green:t.red},
              {label:"1Y Return",      val:pct(stats.ret1y),             color:(stats.ret1y??0)>=0?t.green:t.red},
              {label:"3Y CAGR",        val:pct(stats.cagr3y),            color:(stats.cagr3y??0)>=0?t.green:t.red},
              {label:"5Y CAGR",        val:pct(stats.cagr5y),            color:(stats.cagr5y??0)>=0?t.green:t.red},
              {label:"Since Inception",val:pct(stats.cagrAll),           color:(stats.cagrAll??0)>=0?t.green:t.red},
              {label:"Sharpe (3Y)",    val:stats.sharpe!=null?fmt(stats.sharpe):"--",color:t.text},
              {label:"Max Drawdown",   val:pct(stats.maxDD),             color:t.red},
            ].map(item=>(
              <div key={item.label} style={s.sCell}>
                <div style={s.sLbl}>{item.label}</div>
                <div style={{...s.sVal,color:item.color}}>{item.val}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={s.tabRow}>
          {TABS.map(tab=><div key={tab} style={s.tab(activeTab===tab)} onClick={()=>setActiveTab(tab)}>{tab}</div>)}
        </div>

        {/* ── NAV CHART ── */}
        {activeTab==="NAV Chart"&&(
          <div style={s.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:18}}>
              <div style={s.ctitle}>NAV History</div>
              <RangeBtns ranges={["YTD","1Y","3Y","5Y","ALL"]} active={navRange} onSet={setNavRange}/>
            </div>
            <div style={{height:300}}><LineChart data={fund.data} t={t} range={navRange}/></div>
            {stats&&(
              <div style={{display:"flex",gap:20,marginTop:14,flexWrap:"wrap"}}>
                {[{label:"Inception Date",val:stats.inceptionDate},{label:"Latest Date",val:stats.latestDate},{label:"Data Points",val:fund.data.length.toLocaleString()}].map(m=>(
                  <div key={m.label} style={{fontSize:12}}><span style={{color:t.textMuted}}>{m.label}: </span><span style={{fontWeight:600}}>{m.val}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RETURNS ── */}
        {activeTab==="Returns"&&(
          <>
            <div style={s.card}>
              <div style={s.ctitle}>Trailing Returns (%)</div>
              <div style={{overflowX:"auto"}}>
                <table style={s.table}>
                  <thead><tr><th style={s.thL}>Period</th>{trailing.map(r=><th key={r.period} style={s.th}>{r.period}</th>)}</tr></thead>
                  <tbody>
                    <tr><td style={s.tdL}>Return (%)</td>{trailing.map(r=><td key={r.period} style={{...s.td,...cv(r.ret)}}>{r.ret!=null?fmt(r.ret):"--"}</td>)}</tr>
                    <tr><td style={s.tdL}>CAGR (%)</td>{trailing.map(r=><td key={r.period} style={{...s.td,...cv(r.cagr)}}>{r.cagr!=null?fmt(r.cagr):"--"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div style={s.card}>
              <div style={s.ctitle}>Calendar Year Returns (%)</div>
              <div style={{overflowX:"auto"}}>
                <table style={s.table}>
                  <thead><tr><th style={s.thL}>Year</th>{calYear.map(r=><th key={r.year} style={s.th}>{r.year}</th>)}</tr></thead>
                  <tbody><tr><td style={s.tdL}>Return (%)</td>{calYear.map(r=><td key={r.year} style={{...s.td,...cv(r.ret)}}>{fmt(r.ret)}</td>)}</tr></tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── ANNUAL ── */}
        {activeTab==="Annual"&&(
          <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 320px"}}>
              <div style={s.card}>
                <div style={s.ctitle}>Annual Returns &amp; Volatility</div>
                <table style={s.table}>
                  <thead><tr><th style={s.thL}>YEAR</th><th style={s.th}>RETURN</th><th style={s.th}>VOLATILITY</th></tr></thead>
                  <tbody>
                    {annualVol.map(row=>(
                      <tr key={row.year}>
                        <td style={s.tdL}>{row.year}{row.isYTD&&<span style={{marginLeft:6,fontSize:10,backgroundColor:t.accent,color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:600}}>YTD</span>}</td>
                        <td style={{...s.td,...cv(row.ret),fontWeight:600}}>{fmt(row.ret)}%</td>
                        <td style={{...s.td,color:t.textSub}}>{row.vol!=null?fmt(row.vol)+"%":"--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{flex:"2 1 400px"}}>
              <div style={s.card}>
                <div style={s.ctitle}>Annual Returns Chart</div>
                <div style={{height:320}}><AnnualBarChart data={annualVol} t={t}/></div>
              </div>
            </div>
          </div>
        )}

        {/* ── RISK METRICS ── */}
        {activeTab==="Risk Metrics"&&stats&&(
          <>
            <div style={s.card}>
              <div style={s.ctitle}>Risk Metrics (3-Year Window)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
                {[
                  {label:"3Y CAGR",          val:pct(stats.cagr3y),   color:(stats.cagr3y??0)>=0?t.green:t.red},
                  {label:"5Y CAGR",          val:pct(stats.cagr5y),   color:(stats.cagr5y??0)>=0?t.green:t.red},
                  {label:"Since Inception",  val:pct(stats.cagrAll),  color:(stats.cagrAll??0)>=0?t.green:t.red},
                  {label:"Sharpe Ratio (3Y)",val:stats.sharpe!=null?fmt(stats.sharpe):"--",color:(stats.sharpe??0)>=1?t.green:t.textSub},
                  {label:"Sortino Ratio (3Y)",val:stats.sortino!=null?fmt(stats.sortino):"--",color:(stats.sortino??0)>=1?t.green:t.textSub},
                  {label:"Std Dev (Ann.) %", val:stats.stdDev!=null?fmt(stats.stdDev)+"%":"--",color:t.text},
                  {label:"Max Drawdown",     val:pct(stats.maxDD),    color:t.red},
                  {label:"Drawdown Date",    val:stats.ddDate??"--",  color:t.textSub},
                  {label:"Risk-Free Rate",   val:"6.0% p.a.",         color:t.textMuted},
                ].map(m=>(<div key={m.label} style={s.mBox}><div style={s.mLbl}>{m.label}</div><div style={{...s.mVal,color:m.color}}>{m.val}</div></div>))}
              </div>
            </div>
            <div style={s.card}>
              <div style={s.ctitle}>Annual Return by Calendar Year</div>
              <div style={{overflowX:"auto"}}>
                <table style={s.table}>
                  <thead><tr><th style={s.thL}>Year</th><th style={s.th}>Calendar Return %</th><th style={s.th}>Result</th></tr></thead>
                  <tbody>{calYear.map(r=>(<tr key={r.year}><td style={s.tdL}>{r.year}</td><td style={{...s.td,...cv(r.ret)}}>{fmt(r.ret)}%</td><td style={{...s.td,color:r.ret>=0?t.green:t.red}}>{r.ret>=0?"▲ Positive":"▼ Negative"}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── BEST/WORST ── */}
        {activeTab==="Best/Worst"&&bestWorst&&(
          <div style={s.card}>
            <div style={s.ctitle}>Best &amp; Worst Periods</div>
            <div style={{overflowX:"auto"}}>
              <table style={s.table}>
                <thead><tr><th style={s.thL}></th>{["WEEK","MONTH","QUARTER","YEAR"].flatMap(p=>[<th key={p+"B"} style={{...s.th,color:t.green}}>{p} BEST</th>,<th key={p+"W"} style={{...s.th,color:t.red}}>{p} WORST</th>])}</tr></thead>
                <tbody>
                  {[{label:"Return (%)",fn:(p,bw)=>bw?fmt(bw.ret)+"%":"--",bwC:true},{label:"Begin",fn:(p,bw)=>bw?.begin??"--",bwC:false},{label:"End",fn:(p,bw)=>bw?.end??"--",bwC:false}].map(row=>(
                    <tr key={row.label}><td style={s.tdL}>{row.label}</td>{["week","month","quarter","year"].flatMap(p=>[<td key={p+"b"} style={{...s.td,color:row.bwC?t.green:t.text,fontWeight:row.bwC?600:400}}>{row.fn(p,bestWorst[p]?.best)}</td>,<td key={p+"w"} style={{...s.td,color:row.bwC?t.red:t.text,fontWeight:row.bwC?600:400}}>{row.fn(p,bestWorst[p]?.worst)}</td>])}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── ROLLING RETURNS ── */}
        {activeTab==="Rolling Returns"&&(
          <div style={s.card}>
            <div style={{...s.ctitle,marginBottom:14}}>Rolling Returns (CAGR)</div>
            <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
              {[1,3,5,7,10,12,15].map(y=>(
                <button key={y} onClick={()=>setRollingYears(y)} style={{padding:"5px 16px",borderRadius:20,border:`1px solid ${rollingYears===y?t.accent:t.border}`,backgroundColor:rollingYears===y?t.accent:t.chip,color:rollingYears===y?"#fff":t.text,cursor:"pointer",fontSize:13,fontWeight:rollingYears===y?600:400}}>{y}Y</button>
              ))}
            </div>
            <div style={{height:300}}><RollingChart data={rollingData} t={t}/></div>
            {rollingData?.length>0&&(
              <div style={{display:"flex",gap:12,marginTop:18,flexWrap:"wrap"}}>
                {[{label:"Min CAGR",val:Math.min(...rollingData.map(d=>d.cagr)),color:t.red},{label:"Max CAGR",val:Math.max(...rollingData.map(d=>d.cagr)),color:t.green},{label:"Avg CAGR",val:rollingData.reduce((a,b)=>a+b.cagr,0)/rollingData.length,color:t.accent},{label:"% Positive",val:rollingData.filter(d=>d.cagr>0).length/rollingData.length*100,color:t.green,suffix:"%"},{label:"Data Points",val:rollingData.length,color:t.textSub,suffix:""}].map(m=>(
                  <div key={m.label} style={s.mBox}><div style={s.mLbl}>{m.label}</div><div style={{...s.mVal,color:m.color,fontSize:18}}>{typeof m.val==="number"?fmt(m.val):m.val}{m.suffix??"%"}</div></div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── MONTHLY HEATMAP ── */}
        {activeTab==="Monthly Heatmap"&&(
          <div style={s.card}>
            <div style={s.ctitle}>Monthly Returns Heatmap</div>
            <div style={{overflowX:"auto"}}>
              <table style={{...s.table,minWidth:780}}>
                <thead><tr><th style={s.thL}>YEAR</th>{MONTHS.map(m=><th key={m} style={s.th}>{m}</th>)}<th style={s.th}>TOTAL</th></tr></thead>
                <tbody>
                  {Object.keys(monthly).sort().reverse().map(year=>{
                    const total=Object.values(monthly[year]).reduce((a,b)=>a+b,0);
                    return(
                      <tr key={year}>
                        <td style={s.tdL}>{year}</td>
                        {[...Array(12)].map((_,mi)=>{ const v=monthly[year][mi]; const intensity=Math.min(Math.abs(v??0)/15,1); const bg=v==null?"transparent":v>=0?`rgba(22,163,74,${0.08+intensity*0.5})`:`rgba(220,38,38,${0.08+intensity*0.5})`; return(<td key={mi} title={v!=null?`${MONTHS[mi]} ${year}: ${fmt(v)}%`:undefined} style={{...s.td,backgroundColor:bg,color:v==null?t.textMuted:v>=0?t.green:t.red,fontWeight:500,fontSize:12}}>{v!=null?fmt(v):"--"}</td>); })}
                        <td style={{...s.td,...cv(total),fontWeight:700}}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SIP CALCULATOR ── */}
        {activeTab==="SIP Calculator"&&(
          <div style={s.card}>
            <div style={s.ctitle}>SIP &amp; Lumpsum Calculator</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:16,marginBottom:22}}>
              {[{key:"lumpsum",label:"Lumpsum Amount (₹)",step:10000,min:0},{key:"monthly",label:"Monthly SIP (₹)",step:1000,min:0},{key:"duration",label:"Investment Duration (Yrs)",step:1,min:1,max:40},{key:"expense",label:"Expense Ratio (% p.a.)",step:0.05,min:0,max:5}].map(f=>(
                <div key={f.key} style={{flex:"1 1 200px"}}>
                  <div style={{fontSize:11,color:t.textMuted,marginBottom:7,textTransform:"uppercase",letterSpacing:"0.6px"}}>{f.label}</div>
                  <input type="number" step={f.step} min={f.min} max={f.max} value={sip[f.key]} onChange={e=>setSip(p=>({...p,[f.key]:parseFloat(e.target.value)||0}))} style={{width:"100%",padding:"11px 14px",borderRadius:9,border:`1.5px solid ${t.border}`,backgroundColor:t.input,color:t.text,fontSize:14,outline:"none",boxSizing:"border-box"}}/>
                </div>
              ))}
            </div>
            <button onClick={calcSIP} style={{padding:"12px 36px",borderRadius:10,background:`linear-gradient(135deg,${t.accent},#6366f1)`,color:"#fff",border:"none",cursor:"pointer",fontSize:15,fontWeight:700}}>Calculate Returns</button>
            {sipResult&&(
              <div style={{marginTop:28}}>
                <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:20}}>
                  {[{label:"Total Invested",val:fmtCr(sipResult.invested),color:t.text},{label:"SIP Corpus",val:fmtCr(sipResult.sipFV),color:t.green},{label:"Lumpsum Corpus",val:fmtCr(sipResult.lsFV),color:t.green},{label:"Total Corpus",val:fmtCr(sipResult.total),color:t.accent},{label:"Estimated Gain",val:fmtCr(sipResult.gain),color:sipResult.gain>=0?t.green:t.red},{label:"Applied CAGR",val:pct(sipResult.cagr),color:t.text},{label:"Wealth Multiplier",val:fmt(sipResult.total/sipResult.invested,2)+"x",color:t.accent}].map(m=>(<div key={m.label} style={s.mBox}><div style={s.mLbl}>{m.label}</div><div style={{...s.mVal,color:m.color}}>{m.val}</div></div>))}
                </div>
                <div style={{backgroundColor:t.bg,border:`1px solid ${t.border}`,borderRadius:12,padding:18}}>
                  <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>Investment Breakdown</div>
                  <div style={{height:32,borderRadius:8,overflow:"hidden",display:"flex",marginBottom:10}}>
                    <div style={{width:`${sipResult.invested/sipResult.total*100}%`,background:t.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:600,minWidth:40}}>Invested</div>
                    <div style={{flex:1,background:t.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:600}}>Returns</div>
                  </div>
                  <div style={{fontSize:11,color:t.textMuted,marginTop:8,lineHeight:1.6}}>* Applied CAGR = Fund's 5Y CAGR ({fmt(stats?.cagr5y)}%) − Expense Ratio ({sip.expense}%). Results are indicative only. Not financial advice.</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── COMPARE ── */}
        {activeTab==="Compare"&&(
          <div>
            <div style={{...s.card,marginBottom:16}}>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:16}}>
                {cmpFunds.map((f,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,backgroundColor:t.bg,border:`1.5px solid ${COMPARE_COLORS[i%COMPARE_COLORS.length]}`,borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:500}}>
                    <span style={{width:8,height:8,borderRadius:"50%",backgroundColor:COMPARE_COLORS[i%COMPARE_COLORS.length],display:"inline-block"}}/>
                    <span style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span>
                    <span onClick={()=>setCmpFunds(p=>p.filter((_,idx)=>idx!==i))} style={{cursor:"pointer",color:t.textMuted,fontSize:16,marginLeft:2,lineHeight:1}}>×</span>
                  </div>
                ))}
                {cmpFunds.length<6&&(
                  <div ref={cmpSearchRef} style={{position:"relative",flex:"1 1 240px",minWidth:200}}>
                    <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:t.textMuted,fontSize:13,pointerEvents:"none"}}>🔍</span>
                    <input style={{...s.sinput,paddingLeft:34,fontSize:13}} placeholder="+ Add another fund to compare…" value={cmpQuery} onChange={e=>handleCmpSearch(e.target.value)}/>
                    <Dropdown items={cmpSugg} onSelect={addCmpFund}/>
                  </div>
                )}
                {cmpLoading&&<span style={{color:t.textMuted,fontSize:12}}>Loading…</span>}
              </div>
              {cmpFunds.length<2&&<div style={{color:t.textMuted,fontSize:13}}>👆 Add at least 2 funds to compare. The current fund is pre-loaded.</div>}
            </div>

            {cmpFunds.length>=2&&(
              <>
                <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                  {["NAV","Returns","Risk","Best/Worst","Rolling"].map(ct=>(
                    <button key={ct} onClick={()=>setCmpTab(ct)} style={{padding:"7px 18px",borderRadius:8,border:`1px solid ${cmpTab===ct?t.accent:t.border}`,backgroundColor:cmpTab===ct?t.accent:t.chip,color:cmpTab===ct?"#fff":t.text,cursor:"pointer",fontSize:13,fontWeight:cmpTab===ct?600:400}}>{ct}</button>
                  ))}
                </div>

                {cmpTab==="NAV"&&cmpRebased&&(
                  <div style={s.card}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:16}}>
                      <div><div style={s.ctitle}>NAV (Rebased to 100)</div><div style={{fontSize:12,color:t.textMuted}}>Common range: {cmpRebased.startDate} → {cmpRebased.endDate}</div></div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                        {cmpRebased.series.map((s2,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}>
                            <span style={{width:20,height:3,backgroundColor:s2.color,display:"inline-block",borderRadius:2}}/>
                            <span style={{maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.textSub}}>{s2.name.split("–")[0].trim()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{height:340}}><CompareChart series={cmpRebased.series} t={t}/></div>
                  </div>
                )}
                {cmpTab==="NAV"&&!cmpRebased&&<div style={{...s.card,color:t.textMuted,textAlign:"center",padding:40}}>No common date range found between these funds.</div>}

                {cmpTab==="Returns"&&(
                  <div style={s.card}>
                    <div style={s.ctitle}>Returns Comparison</div>
                    <div style={{overflowX:"auto"}}>
                      <table style={s.table}>
                        <thead><tr><th style={s.thL}>Fund</th>{["1D","1M","3M","6M","1Y CAGR","3Y CAGR","5Y CAGR","Since Inception"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {cmpFunds.map((f,i)=>{ const st=cmpStats[i]; if(!st) return null; return(
                            <tr key={i}>
                              <td style={{...s.tdL,maxWidth:220}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",backgroundColor:COMPARE_COLORS[i%COMPARE_COLORS.length],flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span></div></td>
                              {[st.ret1d,(() => { const n=getNavAt(f.data,30);  return n?(st.latest-n)/n*100:null; })(),(() => { const n=getNavAt(f.data,91);  return n?(st.latest-n)/n*100:null; })(),(() => { const n=getNavAt(f.data,182); return n?(st.latest-n)/n*100:null; })(),st.ret1y,st.cagr3y,st.cagr5y,st.cagrAll].map((v,j)=><td key={j} style={{...s.td,...cv(v)}}>{pct(v)}</td>)}
                            </tr>
                          ); })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cmpTab==="Risk"&&(
                  <div style={s.card}>
                    <div style={s.ctitle}>Risk Metrics Comparison</div>
                    <div style={{overflowX:"auto"}}>
                      <table style={s.table}>
                        <thead><tr><th style={s.thL}>Fund</th>{["Sharpe (3Y)","Sortino (3Y)","Std Dev %","Max Drawdown"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {cmpFunds.map((f,i)=>{ const st=cmpStats[i]; if(!st) return null; return(
                            <tr key={i}>
                              <td style={{...s.tdL,maxWidth:220}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",backgroundColor:COMPARE_COLORS[i%COMPARE_COLORS.length],flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span></div></td>
                              <td style={{...s.td,color:(st.sharpe??0)>=1?t.green:t.textSub,fontWeight:600}}>{st.sharpe!=null?fmt(st.sharpe):"--"}</td>
                              <td style={{...s.td,color:(st.sortino??0)>=1?t.green:t.textSub,fontWeight:600}}>{st.sortino!=null?fmt(st.sortino):"--"}</td>
                              <td style={{...s.td,color:t.textSub}}>{st.stdDev!=null?fmt(st.stdDev)+"%":"--"}</td>
                              <td style={{...s.td,color:t.red,fontWeight:600}}>{pct(st.maxDD)}</td>
                            </tr>
                          ); })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cmpTab==="Best/Worst"&&(
                  <div style={s.card}>
                    <div style={s.ctitle}>Best &amp; Worst Periods Comparison</div>
                    {["week","month","quarter","year"].map(period=>(
                      <div key={period} style={{marginBottom:20}}>
                        <div style={{fontSize:13,fontWeight:600,color:t.textSub,textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:10}}>{period}</div>
                        <div style={{overflowX:"auto"}}>
                          <table style={s.table}>
                            <thead><tr><th style={s.thL}>Fund</th><th style={{...s.th,color:t.green}}>Best Return</th><th style={s.th}>Best Period</th><th style={{...s.th,color:t.red}}>Worst Return</th><th style={s.th}>Worst Period</th></tr></thead>
                            <tbody>
                              {cmpFunds.map((f,i)=>{ const bw=cmpBW[i]?.[period]; if(!bw) return null; return(
                                <tr key={i}>
                                  <td style={{...s.tdL,maxWidth:200}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",backgroundColor:COMPARE_COLORS[i%COMPARE_COLORS.length],flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span></div></td>
                                  <td style={{...s.td,color:t.green,fontWeight:600}}>{bw.best?fmt(bw.best.ret)+"%":"--"}</td>
                                  <td style={{...s.td,color:t.textMuted,fontSize:11}}>{bw.best?`${bw.best.begin} → ${bw.best.end}`:"--"}</td>
                                  <td style={{...s.td,color:t.red,fontWeight:600}}>{bw.worst?fmt(bw.worst.ret)+"%":"--"}</td>
                                  <td style={{...s.td,color:t.textMuted,fontSize:11}}>{bw.worst?`${bw.worst.begin} → ${bw.worst.end}`:"--"}</td>
                                </tr>
                              ); })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cmpTab==="Rolling"&&(
                  <div style={s.card}>
                    <div style={{...s.ctitle,marginBottom:12}}>Rolling Returns Comparison (CAGR)</div>
                    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                      {[1,3,5,7,10].map(y=>(
                        <button key={y} onClick={()=>setCmpRollingYrs(y)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${cmpRollingYrs===y?t.accent:t.border}`,backgroundColor:cmpRollingYrs===y?t.accent:t.chip,color:cmpRollingYrs===y?"#fff":t.text,cursor:"pointer",fontSize:13,fontWeight:cmpRollingYrs===y?600:400}}>{y}Y</button>
                      ))}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:14}}>
                      {cmpFunds.map((f,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}><span style={{width:20,height:3,backgroundColor:COMPARE_COLORS[i%COMPARE_COLORS.length],display:"inline-block",borderRadius:2}}/><span style={{color:t.textSub,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name?.split("–")[0].trim()}</span></div>))}
                    </div>
                    <div style={{height:300}}>
                      <CompareRollingChart series={cmpRolling.map(s2=>({...s2,points:s2.points.map(p=>({date:p.date,val:p.cagr}))}))} t={t}/>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <button onClick={()=>{setFund(null);setError(null);setSipResult(null);}} style={{padding:"9px 22px",borderRadius:9,border:`1px solid ${t.border}`,backgroundColor:t.chip,color:t.text,cursor:"pointer",fontSize:13,marginTop:10}}>
          ← Back to Search
        </button>
      </div>
    </div>
  );
}
