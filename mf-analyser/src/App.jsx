import { useState, useEffect, useRef, useCallback, useMemo } from "react";

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

// ─── Theme ─────────────────────────────────────────────────────────────────────
const T = {
  light: {
    bg:"#f4f7fb",surface:"#ffffff",card:"#ffffff",border:"#e2e8f0",borderLight:"#edf2f7",
    text:"#0f172a",textSub:"#475569",textMuted:"#94a3b8",
    accent:"#2563eb",green:"#16a34a",red:"#dc2626",
    input:"#f8faff",shadow:"0 2px 16px rgba(0,0,0,0.07)",chip:"#e8edf5",
    tooltip:"#1e293b",tooltipText:"#f8fafc",
  },
  dark: {
    bg:"#0a0e1a",surface:"#111827",card:"#1a2236",border:"#2a3a52",borderLight:"#1e2d42",
    text:"#f0f4ff",textSub:"#8a9bc0",textMuted:"#4a5a78",
    accent:"#3b82f6",green:"#22c55e",red:"#ef4444",
    input:"#1a2236",shadow:"0 4px 24px rgba(0,0,0,0.4)",chip:"#1e2d42",
    tooltip:"#e2e8f0",tooltipText:"#0f172a",
  },
};

const CC     = ["#2563eb","#16a34a","#d97706","#9333ea","#dc2626","#0891b2"];
const TABS   = ["NAV Chart","Returns","Annual","Risk Metrics","Best/Worst","Rolling Returns","Monthly Heatmap","SIP Calculator","Compare"];
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const POPULAR = [
  {name:"Parag Parikh Flexi Cap Fund – Direct – Growth",code:122639},
  {name:"Quant Small Cap Fund – Direct – Growth",code:120828},
  {name:"HDFC Top 100 Fund – Direct – Growth",code:125497},
  {name:"Nippon India Nifty 50 Index – Direct – Growth",code:118989},
  {name:"Mirae Asset Large Cap Fund – Direct – Growth",code:118834},
  {name:"Axis Bluechip Fund – Direct – Growth",code:120503},
];

// ─── Pure helpers (no Date parsing in hot paths) ───────────────────────────────
// Parse date string "DD-MM-YYYY" → timestamp (fast, no Date obj in loops)
function dateToTs(str) {
  const [d,m,y]=str.split("-");
  return Date.UTC(+y,+m-1,+d);
}
function parseDate(str){const[d,m,y]=str.split("-");return new Date(`${y}-${m}-${d}`);}
function fmtDate(str){const d=parseDate(str);return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});}
const fmt  =(n,dec=2)=>n==null||isNaN(n)?"--":Number(n).toFixed(dec);
const pct  =(n)=>n==null||isNaN(n)?"--":(n>0?"+":"")+Number(n).toFixed(2)+"%";
const fmtCr=(n)=>{if(n==null||isNaN(n))return"--";if(Math.abs(n)>=10000000)return"₹"+(n/10000000).toFixed(2)+"Cr";if(Math.abs(n)>=100000)return"₹"+(n/100000).toFixed(2)+"L";return"₹"+n.toFixed(0);};

// Binary search in ascending-sorted array of {ts,nav} to find nav at target ts
function navAtTs(sorted,targetTs){
  let lo=0,hi=sorted.length-1;
  while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid].ts<targetTs)lo=mid+1;else hi=mid;}
  return sorted[lo]?.nav??null;
}

function cagrFn(s,e,y){if(!s||!e||y<=0)return null;return(Math.pow(e/s,1/y)-1)*100;}

// ─── Pre-process data once (convert all dates to timestamps, sort asc) ─────────
function preprocess(raw){
  // raw = [{date:"DD-MM-YYYY", nav:"123.45"}, ...] newest first
  const asc=[...raw].reverse().map(d=>({ts:dateToTs(d.date),date:d.date,nav:parseFloat(d.nav)}));
  return asc; // ascending order, ts cached
}

// ─── Analytics — all operate on preprocessed ascending array ──────────────────
function computeStats(asc){
  if(!asc?.length) return null;
  const latest=asc[asc.length-1].nav, latestTs=asc[asc.length-1].ts;
  const first=asc[0].nav, firstTs=asc[0].ts;
  const yrs=(latestTs-firstTs)/(1000*60*60*24*365.25);
  const cut3Ts=latestTs-3*365.25*24*3600*1000;
  const sl3=asc.filter(d=>d.ts>=cut3Ts);
  let sharpe=null,sortino=null,stdDev=null;
  if(sl3.length>20){
    const rets=sl3.slice(1).map((d,i)=>(d.nav-sl3[i].nav)/sl3[i].nav);
    const mean=rets.reduce((a,b)=>a+b,0)/rets.length;
    const variance=rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length;
    const std=Math.sqrt(variance);
    const neg=rets.filter(r=>r<0);
    const downDev=neg.length>0?Math.sqrt(neg.reduce((a,r)=>a+r*r,0)/neg.length):std;
    stdDev=std*Math.sqrt(252)*100;
    sharpe=stdDev>0?((mean*252-0.06)/(std*Math.sqrt(252))):null;
    sortino=downDev>0?((mean*252-0.06)/(downDev*Math.sqrt(252))):null;
  }
  let peak=-Infinity,maxDD=0,ddDate=null;
  for(const d of asc){if(d.nav>peak)peak=d.nav;const dd=(d.nav-peak)/peak*100;if(dd<maxDD){maxDD=dd;ddDate=d.date;}}
  const nowTs=Date.now();
  const n1y=navAtTs(asc,nowTs-365*86400000),n3y=navAtTs(asc,nowTs-3*365*86400000),n5y=navAtTs(asc,nowTs-5*365*86400000);
  const n1d=navAtTs(asc,nowTs-2*86400000);
  const ytdTs=Date.UTC(new Date().getFullYear(),0,1);
  const nytd=navAtTs(asc,ytdTs);
  return{
    latest,latestDate:asc[asc.length-1].date,inceptionDate:asc[0].date,
    ret1d:n1d?(latest-n1d)/n1d*100:null,
    retytd:nytd?(latest-nytd)/nytd*100:null,
    ret1y:n1y?cagrFn(n1y,latest,1):null,
    cagr3y:n3y?cagrFn(n3y,latest,3):null,
    cagr5y:n5y?cagrFn(n5y,latest,5):null,
    cagrAll:cagrFn(first,latest,yrs),
    sharpe,sortino,stdDev,maxDD,ddDate,yrs,
  };
}

function computeTrailing(asc,st){
  if(!asc?.length||!st) return[];
  const{latest,ret1d,retytd,ret1y,cagr3y,cagr5y,cagrAll,yrs}=st;
  const nowTs=Date.now();
  const g=(d,y)=>{const n=navAtTs(asc,nowTs-d*86400000);return{ret:n?(latest-n)/n*100:null,cagr:y&&n?cagrFn(n,latest,y):null};};
  return[
    {period:"YTD",ret:retytd,cagr:null},
    {period:"1D",ret:ret1d,cagr:null},
    {...g(7),period:"1W"},{...g(30),period:"1M"},{...g(91),period:"3M"},{...g(182),period:"6M"},
    {period:"1Y",...g(365,1)},{period:"3Y",...g(1095,3)},{period:"5Y",...g(1825,5)},
    {period:"7Y",...g(2555,7)},{period:"10Y",...g(3650,10)},
    {period:"Since Inception",ret:(latest-asc[0].nav)/asc[0].nav*100,cagr:cagrAll},
  ];
}

function computeCalYear(asc){
  const m={};
  for(const d of asc){
    const y=new Date(d.ts).getUTCFullYear();
    if(!m[y]){m[y]={first:d,last:d};}else{m[y].last=d;}
  }
  return Object.keys(m).sort().map(y=>({year:+y,ret:(m[y].last.nav-m[y].first.nav)/m[y].first.nav*100}));
}

function computeAnnualVol(asc){
  const m={};
  for(const d of asc){
    const y=new Date(d.ts).getUTCFullYear();
    if(!m[y])m[y]=[];m[y].push(d);
  }
  const cur=new Date().getFullYear();
  return Object.keys(m).sort().reverse().map(y=>{
    const items=m[y];
    const ret=(items[items.length-1].nav-items[0].nav)/items[0].nav*100;
    let vol=null;
    if(items.length>5){
      const rets=items.slice(1).map((d,i)=>(d.nav-items[i].nav)/items[i].nav);
      const mean=rets.reduce((a,b)=>a+b,0)/rets.length;
      const v=rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length;
      vol=Math.sqrt(v)*Math.sqrt(252)*100;
    }
    return{year:+y,ret,vol,isYTD:+y===cur};
  });
}

function computeMonthly(asc){
  const m={};
  for(const d of asc){
    const dt=new Date(d.ts),y=dt.getUTCFullYear(),mo=dt.getUTCMonth();
    if(!m[y])m[y]={};
    if(!m[y][mo])m[y][mo]={first:d,last:d};
    else m[y][mo].last=d;
  }
  const res={};
  Object.keys(m).forEach(y=>{res[y]={};Object.keys(m[y]).forEach(mo=>{res[y][mo]=(m[y][mo].last.nav-m[y][mo].first.nav)/m[y][mo].first.nav*100;});});
  return res;
}

function computeRolling(asc,years){
  const ms=Math.round(years*365.25*86400000);
  const res=[];
  for(let i=1;i<asc.length;i++){
    const end=asc[i],startTs=end.ts-ms;
    // binary search for start
    let lo=0,hi=i-1;
    while(lo<hi){const mid=(lo+hi+1)>>1;if(asc[mid].ts<=startTs)lo=mid;else hi=mid-1;}
    if(asc[lo].ts<=startTs&&asc[lo].ts<end.ts){
      const y=(end.ts-asc[lo].ts)/(365.25*86400000);
      if(y>0) res.push({date:end.date,ts:end.ts,cagr:(Math.pow(end.nav/asc[lo].nav,1/y)-1)*100});
    }
  }
  return res;
}

function computeBestWorst(asc){
  const periods={week:7,month:30,quarter:91,year:365};
  const res={};
  for(const[k,days] of Object.entries(periods)){
    const ms=days*86400000;
    let best=null,worst=null;
    for(let i=1;i<asc.length;i++){
      const end=asc[i],startTs=end.ts-ms;
      let lo=0,hi=i-1;
      while(lo<hi){const mid=(lo+hi+1)>>1;if(asc[mid].ts<=startTs)lo=mid;else hi=mid-1;}
      if(asc[lo].ts<=startTs){
        const r=(end.nav-asc[lo].nav)/asc[lo].nav*100;
        if(!best||r>best.ret)best={ret:r,begin:asc[lo].date,end:end.date};
        if(!worst||r<worst.ret)worst={ret:r,begin:asc[lo].date,end:end.date};
      }
    }
    res[k]={best,worst};
  }
  return res;
}

function rebaseSeries(funds){
  if(funds.length<2) return null;
  const sets=funds.map(f=>new Set(f.asc.map(d=>d.date)));
  const common=[...sets[0]].filter(d=>sets.every(s=>s.has(d))).sort();
  if(common.length<2) return null;
  return{
    series:funds.map((f,i)=>{
      const map=new Map(f.asc.map(d=>[d.date,d.nav]));
      const base=map.get(common[0])??f.asc[0].nav;
      return{name:f.meta?.scheme_name??"Fund "+(i+1),color:CC[i%CC.length],
        points:common.map(date=>({date,val:(map.get(date)??base)/base*100}))};
    }),
    startDate:common[0],endDate:common[common.length-1],
  };
}

// ─── Tooltip ───────────────────────────────────────────────────────────────────
function Tooltip({tip,t}){
  if(!tip) return null;
  return(
    <div style={{position:"absolute",left:tip.x,top:tip.y,transform:"translate(-50%,-100%) translateY(-12px)",
      backgroundColor:t.tooltip,color:t.tooltipText,borderRadius:8,padding:"8px 12px",fontSize:12,
      pointerEvents:"none",zIndex:50,boxShadow:"0 4px 20px rgba(0,0,0,0.25)",whiteSpace:"nowrap",border:`1px solid rgba(255,255,255,0.1)`}}>
      <div style={{fontWeight:700,marginBottom:4,fontSize:11,opacity:0.7,letterSpacing:"0.3px"}}>{tip.date}</div>
      {tip.lines.map((l,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:i<tip.lines.length-1?3:0}}>
          {l.color&&<span style={{width:7,height:7,borderRadius:"50%",backgroundColor:l.color,flexShrink:0}}/>}
          <span style={{opacity:0.7,fontSize:11}}>{l.label}:</span>
          <span style={{fontWeight:700}}>{l.val}</span>
        </div>
      ))}
      <div style={{position:"absolute",bottom:-5,left:"50%",transform:"translateX(-50%)",
        width:0,height:0,borderLeft:"5px solid transparent",borderRight:"5px solid transparent",borderTop:`5px solid ${t.tooltip}`}}/>
    </div>
  );
}

// ─── Throttled mouse handler for charts ───────────────────────────────────────
function useThrottledTip(){
  const [tip,setTip]=useState(null);
  const rafRef=useRef(null);
  const throttledSet=useCallback((val)=>{
    if(rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current=requestAnimationFrame(()=>setTip(val));
  },[]);
  const clear=useCallback(()=>{
    if(rafRef.current) cancelAnimationFrame(rafRef.current);
    setTip(null);
  },[]);
  return{tip,setTip:throttledSet,clearTip:clear};
}

// ─── Line Chart ────────────────────────────────────────────────────────────────
function LineChart({asc,t,range}){
  const{tip,setTip,clearTip}=useThrottledTip();
  const W=900,H=300;
  const gidRef=useRef("gc"+Math.random().toString(36).slice(2,7));

  const fd=useMemo(()=>{
    if(!asc?.length) return[];
    const now=Date.now();
    let cutTs=0;
    if(range==="1Y")cutTs=now-365*86400000;
    else if(range==="3Y")cutTs=now-3*365*86400000;
    else if(range==="5Y")cutTs=now-5*365*86400000;
    else if(range==="YTD")cutTs=Date.UTC(new Date().getFullYear(),0,1);
    return asc.filter(d=>d.ts>=cutTs);
  },[asc,range]);

  const {navs,minV,maxV,pts,col,gid,xL,pad,W2,H2,xf,yf}=useMemo(()=>{
    if(fd.length<2) return{};
    const navs=fd.map(d=>d.nav);
    const minV=Math.min(...navs),maxV=Math.max(...navs);
    const pad={t:20,b:48,l:72,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
    const xf=i=>pad.l+(i/(fd.length-1))*W2;
    const yf=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
    const pts=fd.map((d,i)=>`${xf(i)},${yf(d.nav)}`).join(" ");
    const isUp=fd[fd.length-1].nav>=fd[0].nav;
    const col=isUp?t.green:t.red;
    const gid=gidRef.current;
    const step=Math.max(1,Math.floor(fd.length/7));
    const xL=[];
    for(let i=0;i<fd.length;i+=step){
      const dt=new Date(fd[i].ts);
      xL.push({x:xf(i),label:`${dt.getUTCMonth()+1}/${String(dt.getUTCFullYear()).slice(2)}`});
    }
    return{navs,minV,maxV,pts,col,gid,xL,pad,W2,H2,xf,yf};
  },[fd,t]);

  // Store latest fd+geometry in a ref so handleMove never has stale closures
  const chartRef=useRef({});
  useEffect(()=>{
    if(fd.length>=2) chartRef.current={fd,W2:W-72-20,padL:72,xf:i=>72+(i/(fd.length-1))*(W-72-20),yf:v=>{const navs=fd.map(d=>d.nav);const minV=Math.min(...navs),maxV=Math.max(...navs);return 20+(1-(v-minV)/(maxV-minV||1))*(H-20-48);}};
  },[fd]);

  const handleMove=useCallback((e)=>{
    const{fd:cfd,W2:cW2,padL,xf:cxf,yf:cyf}=chartRef.current;
    if(!cfd?.length||!cW2) return;
    const rect=e.currentTarget.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(cfd.length-1,Math.round((svgX-padL)/cW2*(cfd.length-1))));
    const d=cfd[idx];
    setTip({x:(cxf(idx)/W)*rect.width,y:(cyf(d.nav)/H)*rect.height,
      date:fmtDate(d.date),lines:[{label:"NAV",val:`₹${fmt(d.nav)}`}]});
  },[]);

  if(fd.length<2) return<div style={{color:t.textMuted,textAlign:"center",paddingTop:60}}>Not enough data for this range</div>;

  return(
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair",display:"block"}}
        onMouseMove={handleMove} onMouseLeave={clearTip}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.2"/>
            <stop offset="100%" stopColor={col} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0,0.25,0.5,0.75,1].map((r,i)=>{
          const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);
          return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-8} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}</text></g>);
        })}
        <polygon points={`${pad.l},${pad.t+H2} ${pts} ${pad.l+W2},${pad.t+H2}`} fill={`url(#${gid})`}/>
        <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"/>
        {tip&&<line x1={(tip.x/((W2/(fd.length-1))*fd.length))*W2+pad.l} x2={(tip.x/((W2/(fd.length-1))*fd.length))*W2+pad.l} y1={pad.t} y2={pad.t+H2} stroke={t.textMuted} strokeWidth="1" strokeDasharray="3,3" opacity="0.5"/>}
        {xL.map((l,i)=><text key={i} x={l.x} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Rolling Chart ─────────────────────────────────────────────────────────────
function RollingChart({data,t,color}){
  const{tip,setTip,clearTip}=useThrottledTip();
  const W=900,H=300;
  const col=color??t.accent;

  const{minV,maxV,pts,zY,xL,pad,W2,H2,xf,yf}=useMemo(()=>{
    if(!data?.length) return{};
    const vals=data.map(d=>d.cagr);
    const minV=Math.min(...vals,0),maxV=Math.max(...vals);
    const pad={t:20,b:48,l:60,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
    const xf=i=>pad.l+(i/(data.length-1))*W2;
    const yf=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
    const pts=data.map((d,i)=>`${xf(i)},${yf(d.cagr)}`).join(" ");
    const zY=yf(0);
    const step=Math.max(1,Math.floor(data.length/7));
    const xL=[];
    for(let i=0;i<data.length;i+=step) xL.push({x:xf(i),label:String(new Date(data[i].ts??0).getUTCFullYear()||new Date(parseDate(data[i].date)).getFullYear())});
    return{minV,maxV,pts,zY,xL,pad,W2,H2,xf,yf};
  },[data]);

  const handleMove=useCallback((e)=>{
    if(!data?.length||!W2) return;
    const rect=e.currentTarget.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(data.length-1,Math.round((svgX-pad.l)/W2*(data.length-1))));
    const d=data[idx];
    setTip({x:(xf(idx)/W)*rect.width,y:(yf(d.cagr)/H)*rect.height,
      date:fmtDate(d.date),lines:[{label:"CAGR",val:pct(d.cagr),color:col}]});
  },[data,W2,pad,xf,yf,col]);

  if(!data?.length) return<div style={{color:t.textMuted,padding:"60px",textAlign:"center"}}>Not enough data for this rolling window</div>;

  return(
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair",display:"block"}}
        onMouseMove={handleMove} onMouseLeave={clearTip}>
        {[0,0.25,0.5,0.75,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}%</text></g>);})}
        <line x1={pad.l} x2={pad.l+W2} y1={zY} y2={zY} stroke={t.textMuted} strokeWidth="1"/>
        <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round"/>
        {xL.map((l,i)=><text key={i} x={l.x} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Annual Bar Chart ──────────────────────────────────────────────────────────
function AnnualBarChart({data,t}){
  const{tip,setTip,clearTip}=useThrottledTip();
  const W=900,H=320;
  const items=useMemo(()=>[...data].reverse(),[data]);
  const{maxAbs,pad,W2,H2,zY,barW}=useMemo(()=>{
    const maxAbs=Math.max(...items.map(d=>Math.abs(d.ret)),1);
    const pad={t:30,b:48,l:50,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
    const zY=pad.t+H2/2;
    const barW=Math.max(8,Math.min(44,(W2/items.length)-6));
    return{maxAbs,pad,W2,H2,zY,barW};
  },[items]);

  const handleEnter=useCallback((e,d,i)=>{
    const rect=e.currentTarget.closest("svg").getBoundingClientRect();
    const cx=pad.l+(i+0.5)*(W2/items.length);
    setTip({x:(cx/W)*rect.width,y:(zY/H)*rect.height,
      date:String(d.year)+(d.isYTD?" (YTD)":""),
      lines:[{label:"Return",val:pct(d.ret),color:d.ret>=0?t.green:t.red},{label:"Volatility",val:d.vol!=null?fmt(d.vol)+"%":"--"}]});
  },[items,pad,W2,zY,t]);

  if(!data?.length) return null;
  return(
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",display:"block"}} onMouseLeave={clearTip}>
        {[-30,-20,-10,0,10,20,30,40,50,60].map((v,i)=>{
          const yp=zY-(v/maxAbs)*(H2/2);if(yp<pad.t-2||yp>pad.t+H2+2)return null;
          return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth={v===0?1:0.5} strokeDasharray={v===0?"none":"3,3"}/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="10" fill={t.textMuted}>{v}%</text></g>);
        })}
        {items.map((d,i)=>{
          const cx=pad.l+(i+0.5)*(W2/items.length);
          const barH=Math.abs(d.ret)/maxAbs*(H2/2);
          const y=d.ret>=0?zY-barH:zY;
          const col=d.ret>=0?t.green:t.red;
          return(
            <g key={d.year} style={{cursor:"pointer"}} onMouseEnter={e=>handleEnter(e,d,i)}>
              <rect x={cx-barW/2} y={y} width={barW} height={Math.max(barH,1)} fill={col} opacity="0.85" rx="2"/>
              <text x={cx} y={H-10} textAnchor="middle" fontSize="10" fill={t.textMuted}>{d.year}</text>
            </g>
          );
        })}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Compare NAV Chart ─────────────────────────────────────────────────────────
function CompareChart({series,t}){
  const{tip,setTip,clearTip}=useThrottledTip();
  const W=900,H=340;
  const{minV,maxV,pad,W2,H2,n,xf,yf,xL}=useMemo(()=>{
    if(!series?.length) return{};
    const allPts=series.flatMap(s=>s.points.map(p=>p.val));
    const minV=Math.min(...allPts),maxV=Math.max(...allPts);
    const pad={t:20,b:48,l:68,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
    const n=series[0]?.points?.length??0;
    const xf=i=>pad.l+(i/(n-1))*W2,yf=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
    const step=Math.max(1,Math.floor(n/8));
    const xL=[];
    for(let i=0;i<n;i+=step){const dt=parseDate(series[0].points[i].date);xL.push({x:xf(i),label:`${dt.getMonth()+1}/${String(dt.getFullYear()).slice(2)}`});}
    return{minV,maxV,pad,W2,H2,n,xf,yf,xL};
  },[series]);

  const handleMove=useCallback((e)=>{
    if(!n||!W2) return;
    const rect=e.currentTarget.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    const idx=Math.max(0,Math.min(n-1,Math.round((svgX-pad.l)/W2*(n-1))));
    const d0=series[0].points[idx];
    const avgY=series.reduce((s,sr)=>s+yf(sr.points[idx]?.val??minV),0)/series.length;
    setTip({x:(xf(idx)/W)*rect.width,y:(avgY/H)*rect.height,date:fmtDate(d0.date),
      lines:series.map(s=>({label:s.name.split("–")[0].trim().slice(0,22),val:fmt(s.points[idx]?.val??0),color:s.color}))});
  },[series,n,W2,pad,xf,yf,minV]);

  if(!series?.length||n<2) return null;
  return(
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair",display:"block"}}
        onMouseMove={handleMove} onMouseLeave={clearTip}>
        {[0,0.2,0.4,0.6,0.8,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{Math.round(v)}</text></g>);})}
        {series.map(s=><polyline key={s.name} points={s.points.map((p,i)=>`${xf(i)},${yf(p.val)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>)}
        {xL.map((l,i)=><text key={i} x={l.x} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{l.label}</text>)}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Compare Rolling Chart ─────────────────────────────────────────────────────
function CompareRollingChart({series,t}){
  const{tip,setTip,clearTip}=useThrottledTip();
  const W=900,H=300;
  const{minV,maxV,zY,pad,W2,H2}=useMemo(()=>{
    if(!series?.length) return{};
    const allPts=series.flatMap(s=>s.points.map(p=>p.val));
    const minV=Math.min(...allPts,0),maxV=Math.max(...allPts);
    const pad={t:20,b:48,l:60,r:20},W2=W-pad.l-pad.r,H2=H-pad.t-pad.b;
    const zY=pad.t+(1-(0-minV)/(maxV-minV||1))*H2;
    return{minV,maxV,zY,pad,W2,H2};
  },[series]);

  const handleMove=useCallback((e)=>{
    if(!series?.length||!W2) return;
    const ref=series.reduce((a,b)=>a.points.length>b.points.length?a:b);
    const n=ref.points.length;if(!n)return;
    const rect=e.currentTarget.getBoundingClientRect();
    const svgX=(e.clientX-rect.left)/rect.width*W;
    const xf2=i=>pad.l+(i/(n-1))*W2;
    const idx=Math.max(0,Math.min(n-1,Math.round((svgX-pad.l)/W2*(n-1))));
    setTip({x:(xf2(idx)/W)*rect.width,y:(zY/H)*rect.height,date:fmtDate(ref.points[idx].date),
      lines:series.map(s=>{const p=s.points[Math.min(idx,s.points.length-1)];return{label:s.name.split("–")[0].trim().slice(0,22),val:pct(p?.val??0),color:s.color};})});
  },[series,W2,pad,zY]);

  if(!series?.length||!series[0]?.points?.length) return<div style={{color:t.textMuted,padding:40,textAlign:"center"}}>Not enough data</div>;
  return(
    <div style={{position:"relative",height:"100%"}}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"100%",cursor:"crosshair",display:"block"}}
        onMouseMove={handleMove} onMouseLeave={clearTip}>
        {[0,0.25,0.5,0.75,1].map((r,i)=>{const yp=pad.t+r*H2,v=maxV-r*(maxV-minV);return(<g key={i}><line x1={pad.l} x2={pad.l+W2} y1={yp} y2={yp} stroke={t.border} strokeWidth="0.5" strokeDasharray="4,4"/><text x={pad.l-6} y={yp+4} textAnchor="end" fontSize="11" fill={t.textMuted}>{fmt(v)}%</text></g>);})}
        <line x1={pad.l} x2={pad.l+W2} y1={zY} y2={zY} stroke={t.textMuted} strokeWidth="1"/>
        {series.map(s=>{
          const n=s.points.length;if(n<2)return null;
          const xf2=i=>pad.l+(i/(n-1))*W2,yf2=v=>pad.t+(1-(v-minV)/(maxV-minV||1))*H2;
          const step=Math.max(1,Math.floor(n/7));
          return(<g key={s.name}>
            <polyline points={s.points.map((p,i)=>`${xf2(i)},${yf2(p.val)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"/>
            {[...Array(Math.ceil(n/step))].map((_,k)=>{const i=Math.min(k*step,n-1);const dt=parseDate(s.points[i].date);return<text key={i} x={xf2(i)} y={H-10} textAnchor="middle" fontSize="11" fill={t.textMuted}>{dt.getFullYear()}</text>;})}
          </g>);
        })}
      </svg>
      {tip&&<Tooltip tip={tip} t={t}/>}
    </div>
  );
}

// ─── Standalone UI components (OUTSIDE App to prevent remount on every render) ─
function Dropdown({items,onSelect,styles,t}){
  if(!items?.length) return null;
  return(
    <div style={styles.drop}>
      {items.map(su=>(
        <div key={su.schemeCode} style={styles.ditem}
          onMouseEnter={e=>e.currentTarget.style.backgroundColor=t.chip}
          onMouseLeave={e=>e.currentTarget.style.backgroundColor="transparent"}
          onMouseDown={e=>{
            e.preventDefault(); // prevent outside-click handler from firing first
            onSelect(su.schemeCode);
          }}>
          <span style={{flex:1,paddingRight:8,lineHeight:1.4}}>{su.schemeName}</span>
          <span style={{color:t.textMuted,fontSize:11,whiteSpace:"nowrap"}}>#{su.schemeCode}</span>
        </div>
      ))}
    </div>
  );
}

function RangeBtns({ranges,active,onSet,t}){
  return(
    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
      {ranges.map(r=>(
        <button key={r} onClick={()=>onSet(r)} style={{
          padding:"5px 13px",borderRadius:7,
          border:`1px solid ${active===r?t.accent:t.border}`,
          backgroundColor:active===r?t.accent:t.chip,
          color:active===r?"#fff":t.text,
          cursor:"pointer",fontSize:12,fontWeight:active===r?600:400
        }}>{r}</button>
      ))}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App(){
  const[isDark,setIsDark]           =useState(false);
  const t                           =T[isDark?"dark":"light"];
  const[query,setQuery]             =useState("");
  const[suggestions,setSuggestions] =useState([]);
  const[searching,setSearching]     =useState(false);
  const[fund,setFund]               =useState(null); // {meta, raw(desc), asc(preproc)}
  const[loading,setLoading]         =useState(false);
  const[error,setError]             =useState(null);
  const[activeTab,setActiveTab]     =useState("NAV Chart");
  const[navRange,setNavRange]       =useState("ALL");
  const[rollingYears,setRollingYears]=useState(3);
  const[sip,setSip]                 =useState({lumpsum:100000,monthly:10000,duration:5,expense:1.5});
  const[sipResult,setSipResult]     =useState(null);
  const[cmpFunds,setCmpFunds]       =useState([]); // [{meta,asc}]
  const[cmpQuery,setCmpQuery]       =useState("");
  const[cmpSugg,setCmpSugg]         =useState([]);
  const[cmpLoading,setCmpLoading]   =useState(false);
  const[cmpTab,setCmpTab]           =useState("NAV");
  const[cmpRollingYrs,setCmpRollingYrs]=useState(3);
  const debRef=useRef(null),cmpDebRef=useRef(null);
  const searchRef=useRef(null),cmpSearchRef=useRef(null);

  useEffect(()=>{
    // Use mousedown so we can detect outside clicks,
    // but Dropdown items use e.preventDefault() on mousedown to win the race
    const h=e=>{
      if(searchRef.current&&!searchRef.current.contains(e.target))setSuggestions([]);
      if(cmpSearchRef.current&&!cmpSearchRef.current.contains(e.target))setCmpSugg([]);
    };
    document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);
  },[]);

  const handleSearch=val=>{
    setQuery(val);clearTimeout(debRef.current);
    if(!val.trim()){setSuggestions([]);return;}
    debRef.current=setTimeout(async()=>{
      setSearching(true);
      try{const j=await fetchWithProxy(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(val)}`);setSuggestions((Array.isArray(j)?j:[]).slice(0,12));}
      catch{setSuggestions([]);}
      setSearching(false);
    },380);
  };

  const loadFund=async code=>{
    setSuggestions([]); // clear immediately on select
    setLoading(true);setError(null);setQuery("");setSipResult(null);
    try{
      const j=await fetchWithProxy(`https://api.mfapi.in/mf/${code}`);
      if(!j?.data?.length)throw new Error("No NAV data");
      const asc=preprocess(j.data);
      const f={meta:j.meta,raw:j.data,asc};
      setFund(f);setActiveTab("NAV Chart");setNavRange("ALL");setCmpFunds([f]);
    }catch(e){setError(e.message||"Failed to load fund");}
    setLoading(false);
  };

  const handleCmpSearch=val=>{
    setCmpQuery(val);clearTimeout(cmpDebRef.current);
    if(!val.trim()){setCmpSugg([]);return;}
    cmpDebRef.current=setTimeout(async()=>{
      try{const j=await fetchWithProxy(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(val)}`);setCmpSugg((Array.isArray(j)?j:[]).slice(0,10));}
      catch{setCmpSugg([]);}
    },380);
  };

  const addCmpFund=async code=>{
    if(cmpFunds.length>=6) return;
    // prevent duplicates
    if(cmpFunds.some(f=>f.meta?.scheme_code===String(code)||f.raw?.[0]?.schemeCode===code)) return;
    setCmpLoading(true); setCmpSugg([]); setCmpQuery("");
    try{
      const j=await fetchWithProxy(`https://api.mfapi.in/mf/${code}`);
      if(j?.data?.length){
        const asc=preprocess(j.data);
        setCmpFunds(p=>[...p,{meta:j.meta,raw:j.data,asc}]);
      }
    }catch(e){ console.error("addCmpFund error:",e); }
    setCmpLoading(false);
  };

  // ── All heavy computations memoized ──────────────────────────────────────────
  const stats     =useMemo(()=>fund?computeStats(fund.asc):null,                    [fund]);
  const trailing  =useMemo(()=>fund?computeTrailing(fund.asc,stats):[]              ,[fund,stats]);
  const calYear   =useMemo(()=>fund?computeCalYear(fund.asc):[]                     ,[fund]);
  const annualVol =useMemo(()=>fund?computeAnnualVol(fund.asc):[]                   ,[fund]);
  const monthly   =useMemo(()=>activeTab==="Monthly Heatmap"&&fund?computeMonthly(fund.asc):{},[fund,activeTab]);
  const bestWorst =useMemo(()=>activeTab==="Best/Worst"&&fund?computeBestWorst(fund.asc):null,[fund,activeTab]);
  const rollingData=useMemo(()=>activeTab==="Rolling Returns"&&fund?computeRolling(fund.asc,rollingYears):[]  ,[fund,activeTab,rollingYears]);
  const cmpRebased=useMemo(()=>activeTab==="Compare"&&cmpFunds.length>=2?rebaseSeries(cmpFunds):null,[cmpFunds,activeTab]);
  const cmpRolling=useMemo(()=>activeTab==="Compare"&&cmpTab==="Rolling"?cmpFunds.map((f,i)=>{
    const pts=computeRolling(f.asc,cmpRollingYrs);
    return{name:f.meta?.scheme_name,color:CC[i%CC.length],points:pts.map(p=>({date:p.date,val:p.cagr}))};
  }):[]  ,[cmpFunds,activeTab,cmpTab,cmpRollingYrs]);
  const cmpStats  =useMemo(()=>cmpFunds.map(f=>computeStats(f.asc))                 ,[cmpFunds]);
  const cmpBW     =useMemo(()=>activeTab==="Compare"&&cmpTab==="Best/Worst"?cmpFunds.map(f=>computeBestWorst(f.asc)):[]  ,[cmpFunds,activeTab,cmpTab]);

  const calcSIP=useCallback(()=>{
    const{lumpsum,monthly:m,duration,expense}=sip;
    const base=stats?.cagr5y??12;const adj=Math.max(0,base-expense);
    const r=adj/100/12,n=duration*12;
    const sipFV=r>0?m*((Math.pow(1+r,n)-1)/r)*(1+r):m*n;
    const lsFV=lumpsum*Math.pow(1+adj/100,duration);
    const total=sipFV+lsFV,inv=lumpsum+m*n;
    setSipResult({sipFV,lsFV,total,invested:inv,gain:total-inv,cagr:adj});
  },[sip,stats]);

  // ── Styles ───────────────────────────────────────────────────────────────────
  const s={
    app:   {minHeight:"100vh",backgroundColor:t.bg,color:t.text,fontFamily:"'DM Sans','Segoe UI',sans-serif"},
    nav:   {backgroundColor:t.surface,borderBottom:`1px solid ${t.border}`,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:60,position:"sticky",top:0,zIndex:100,boxShadow:t.shadow},
    logo:  {display:"flex",alignItems:"center",gap:10,fontWeight:800,fontSize:20,color:t.text,cursor:"pointer",userSelect:"none"},
    lbox:  {width:36,height:36,background:`linear-gradient(135deg,${t.accent},#6366f1)`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18},
    sw:    {position:"relative",flex:1,maxWidth:520,margin:"0 28px"},
    si:    {width:"100%",padding:"9px 16px 9px 40px",borderRadius:10,border:`1.5px solid ${t.border}`,backgroundColor:t.input,color:t.text,fontSize:14,outline:"none",boxSizing:"border-box"},
    sico:  {position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:t.textMuted,fontSize:15,pointerEvents:"none"},
    drop:  {position:"absolute",top:"calc(100% + 6px)",left:0,right:0,backgroundColor:t.surface,border:`1px solid ${t.border}`,borderRadius:12,zIndex:300,overflow:"hidden",boxShadow:t.shadow,maxHeight:360,overflowY:"auto"},
    ditem: {padding:"11px 16px",cursor:"pointer",fontSize:13,borderBottom:`1px solid ${t.borderLight}`,display:"flex",justifyContent:"space-between",alignItems:"center"},
    tbtn:  {padding:"7px 16px",borderRadius:8,border:`1px solid ${t.border}`,backgroundColor:t.chip,color:t.text,cursor:"pointer",fontSize:13,fontWeight:500,whiteSpace:"nowrap"},
    cont:  {maxWidth:1140,margin:"0 auto",padding:"0 20px 80px"},
    card:  {backgroundColor:t.card,border:`1px solid ${t.border}`,borderRadius:14,padding:"20px 22px",marginBottom:20},
    ct:    {fontSize:15,fontWeight:700,color:t.accent,marginBottom:16},
    sb:    {display:"flex",flexWrap:"wrap",gap:1,backgroundColor:t.border,borderRadius:14,overflow:"hidden",marginBottom:20,border:`1px solid ${t.border}`},
    sc:    {flex:"1 1 110px",padding:"14px 14px",backgroundColor:t.card,textAlign:"center"},
    sl:    {fontSize:9,color:t.textMuted,textTransform:"uppercase",letterSpacing:"0.9px",marginBottom:5},
    sv:    {fontSize:17,fontWeight:700,lineHeight:1},
    tr:    {display:"flex",borderBottom:`1px solid ${t.border}`,marginBottom:24,overflowX:"auto",gap:0},
    tab: a=>({padding:"11px 18px",cursor:"pointer",fontSize:13,fontWeight:a?600:400,color:a?t.accent:t.textSub,borderBottom:a?`2.5px solid ${t.accent}`:"2.5px solid transparent",whiteSpace:"nowrap",userSelect:"none",backgroundColor:"transparent"}),
    tbl:   {width:"100%",borderCollapse:"collapse",fontSize:13},
    th:    {padding:"9px 12px",textAlign:"right",color:t.textMuted,fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:"0.6px",borderBottom:`1px solid ${t.border}`},
    thL:   {padding:"9px 12px",textAlign:"left",color:t.textMuted,fontWeight:500,fontSize:11,textTransform:"uppercase",letterSpacing:"0.6px",borderBottom:`1px solid ${t.border}`},
    td:    {padding:"9px 12px",textAlign:"right",borderBottom:`1px solid ${t.borderLight}`,fontSize:13},
    tdL:   {padding:"9px 12px",textAlign:"left",borderBottom:`1px solid ${t.borderLight}`,fontWeight:500,fontSize:13},
    chip:  {display:"inline-block",padding:"7px 14px",backgroundColor:t.chip,borderRadius:20,fontSize:12,cursor:"pointer",border:`1px solid ${t.border}`,margin:"3px"},
    mb:    {flex:"1 1 150px",backgroundColor:t.bg,border:`1px solid ${t.border}`,borderRadius:12,padding:"14px 16px"},
    ml:    {fontSize:11,color:t.textMuted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.6px"},
    mv:    {fontSize:21,fontWeight:700},
  };
  const cv=v=>({color:v==null||isNaN(v)?t.textMuted:v>=0?t.green:t.red,fontWeight:600});

  // Dropdown and RangeBtns are defined outside App (see above) to prevent remount on render

  // ── HOME ──────────────────────────────────────────────────────────────────────
  if(!fund&&!loading) return(
    <div style={s.app}>
      <nav style={s.nav}>
        <div style={s.logo}><div style={s.lbox}>📈</div>MFAnalyser</div>
        <button style={s.tbtn} onClick={()=>setIsDark(p=>!p)}>{isDark?"☀️ Light":"🌙 Dark"}</button>
      </nav>
      <div style={{textAlign:"center",padding:"80px 24px 60px",maxWidth:680,margin:"0 auto"}}>
        <div style={{fontSize:60,marginBottom:20}}>📊</div>
        <h1 style={{fontSize:"clamp(28px,5vw,52px)",fontWeight:800,letterSpacing:"-1.5px",lineHeight:1.1,marginBottom:16}}>Analyse any Indian<br/>Mutual Fund</h1>
        <p style={{color:t.textSub,fontSize:16,lineHeight:1.7,marginBottom:40}}>Live NAV · Rolling CAGRs · Risk Metrics · Annual · Fund Comparison · SIP Calculator<br/>All from public AMFI data — free, no login required.</p>
        <div ref={searchRef} style={{position:"relative",marginBottom:28}}>
          <span style={{position:"absolute",left:18,top:"50%",transform:"translateY(-50%)",fontSize:18,color:t.textMuted,pointerEvents:"none"}}>🔍</span>
          <input style={{width:"100%",padding:"15px 20px 15px 50px",borderRadius:14,border:`1.5px solid ${t.border}`,backgroundColor:t.input,color:t.text,fontSize:16,outline:"none",boxSizing:"border-box",boxShadow:t.shadow}} placeholder="Search e.g. Parag Parikh, HDFC, Nifty 50…" value={query} onChange={e=>handleSearch(e.target.value)}/>
          {searching&&<div style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",color:t.textMuted,fontSize:12}}>Searching…</div>}
          <Dropdown items={suggestions} onSelect={loadFund} styles={s} t={t}/>
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
        <div style={{marginTop:60,fontSize:12,color:t.textMuted,lineHeight:1.8}}>Data from <strong>AMFI India</strong> via mfapi.in · For informational purposes only · Not investment advice</div>
      </div>
    </div>
  );

  if(loading) return(
    <div style={{...s.app,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:48}}>⏳</div>
      <div style={{fontSize:16,color:t.textSub}}>Loading fund data…</div>
      <div style={{fontSize:12,color:t.textMuted}}>Fetching from AMFI · please wait</div>
    </div>
  );

  // ── FUND DETAIL ───────────────────────────────────────────────────────────────
  return(
    <div style={s.app}>
      <nav style={s.nav}>
        <div style={s.logo} onClick={()=>{setFund(null);setError(null);}}>
          <div style={s.lbox}>📈</div>
          <span style={{fontSize:14,fontWeight:600,color:t.textMuted}}>MFAnalyser</span>
        </div>
        <div ref={searchRef} style={s.sw}>
          <span style={s.sico}>🔍</span>
          <input style={s.si} placeholder="Search another fund…" value={query} onChange={e=>handleSearch(e.target.value)}/>
          <Dropdown items={suggestions} onSelect={loadFund} styles={s} t={t}/>
        </div>
        <button style={s.tbtn} onClick={()=>setIsDark(p=>!p)}>{isDark?"☀️ Light":"🌙 Dark"}</button>
      </nav>

      <div style={s.cont}>
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

        {stats&&(
          <div style={s.sb}>
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
              <div key={item.label} style={s.sc}>
                <div style={s.sl}>{item.label}</div>
                <div style={{...s.sv,color:item.color}}>{item.val}</div>
              </div>
            ))}
          </div>
        )}

        <div style={s.tr}>
          {TABS.map(tab=><div key={tab} style={s.tab(activeTab===tab)} onClick={()=>setActiveTab(tab)}>{tab}</div>)}
        </div>

        {/* NAV CHART */}
        {activeTab==="NAV Chart"&&(
          <div style={s.card}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10,marginBottom:18}}>
              <div style={s.ct}>NAV History</div>
              <RangeBtns ranges={["YTD","1Y","3Y","5Y","ALL"]} active={navRange} onSet={setNavRange} t={t}/>
            </div>
            <div style={{height:300}}><LineChart asc={fund.asc} t={t} range={navRange}/></div>
            {stats&&<div style={{display:"flex",gap:20,marginTop:14,flexWrap:"wrap"}}>
              {[{label:"Inception Date",val:stats.inceptionDate},{label:"Latest Date",val:stats.latestDate},{label:"Data Points",val:fund.asc.length.toLocaleString()}].map(m=>(
                <div key={m.label} style={{fontSize:12}}><span style={{color:t.textMuted}}>{m.label}: </span><span style={{fontWeight:600}}>{m.val}</span></div>
              ))}
            </div>}
          </div>
        )}

        {/* RETURNS */}
        {activeTab==="Returns"&&(
          <>
            <div style={s.card}>
              <div style={s.ct}>Trailing Returns (%)</div>
              <div style={{overflowX:"auto"}}>
                <table style={s.tbl}>
                  <thead><tr><th style={s.thL}>Period</th>{trailing.map(r=><th key={r.period} style={s.th}>{r.period}</th>)}</tr></thead>
                  <tbody>
                    <tr><td style={s.tdL}>Return (%)</td>{trailing.map(r=><td key={r.period} style={{...s.td,...cv(r.ret)}}>{r.ret!=null?fmt(r.ret):"--"}</td>)}</tr>
                    <tr><td style={s.tdL}>CAGR (%)</td>{trailing.map(r=><td key={r.period} style={{...s.td,...cv(r.cagr)}}>{r.cagr!=null?fmt(r.cagr):"--"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div style={s.card}>
              <div style={s.ct}>Calendar Year Returns (%)</div>
              <div style={{overflowX:"auto"}}>
                <table style={s.tbl}>
                  <thead><tr><th style={s.thL}>Year</th>{calYear.map(r=><th key={r.year} style={s.th}>{r.year}</th>)}</tr></thead>
                  <tbody><tr><td style={s.tdL}>Return (%)</td>{calYear.map(r=><td key={r.year} style={{...s.td,...cv(r.ret)}}>{fmt(r.ret)}</td>)}</tr></tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ANNUAL */}
        {activeTab==="Annual"&&(
          <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
            <div style={{flex:"1 1 320px"}}>
              <div style={s.card}>
                <div style={s.ct}>Annual Returns &amp; Volatility</div>
                <table style={s.tbl}>
                  <thead><tr><th style={s.thL}>YEAR</th><th style={s.th}>RETURN</th><th style={s.th}>VOLATILITY</th></tr></thead>
                  <tbody>{annualVol.map(row=>(
                    <tr key={row.year}>
                      <td style={s.tdL}>{row.year}{row.isYTD&&<span style={{marginLeft:6,fontSize:10,backgroundColor:t.accent,color:"#fff",borderRadius:4,padding:"1px 5px",fontWeight:600}}>YTD</span>}</td>
                      <td style={{...s.td,...cv(row.ret),fontWeight:600}}>{fmt(row.ret)}%</td>
                      <td style={{...s.td,color:t.textSub}}>{row.vol!=null?fmt(row.vol)+"%":"--"}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div style={{flex:"2 1 400px"}}>
              <div style={s.card}>
                <div style={s.ct}>Annual Returns Chart</div>
                <div style={{height:320}}><AnnualBarChart data={annualVol} t={t}/></div>
              </div>
            </div>
          </div>
        )}

        {/* RISK METRICS */}
        {activeTab==="Risk Metrics"&&stats&&(
          <>
            <div style={s.card}>
              <div style={s.ct}>Risk Metrics (3-Year Window)</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
                {[
                  {label:"3Y CAGR",val:pct(stats.cagr3y),color:(stats.cagr3y??0)>=0?t.green:t.red},
                  {label:"5Y CAGR",val:pct(stats.cagr5y),color:(stats.cagr5y??0)>=0?t.green:t.red},
                  {label:"Since Inception",val:pct(stats.cagrAll),color:(stats.cagrAll??0)>=0?t.green:t.red},
                  {label:"Sharpe Ratio (3Y)",val:stats.sharpe!=null?fmt(stats.sharpe):"--",color:(stats.sharpe??0)>=1?t.green:t.textSub},
                  {label:"Sortino Ratio (3Y)",val:stats.sortino!=null?fmt(stats.sortino):"--",color:(stats.sortino??0)>=1?t.green:t.textSub},
                  {label:"Std Dev (Ann.) %",val:stats.stdDev!=null?fmt(stats.stdDev)+"%":"--",color:t.text},
                  {label:"Max Drawdown",val:pct(stats.maxDD),color:t.red},
                  {label:"Drawdown Date",val:stats.ddDate??"--",color:t.textSub},
                  {label:"Risk-Free Rate",val:"6.0% p.a.",color:t.textMuted},
                ].map(m=>(<div key={m.label} style={s.mb}><div style={s.ml}>{m.label}</div><div style={{...s.mv,color:m.color}}>{m.val}</div></div>))}
              </div>
            </div>
            <div style={s.card}>
              <div style={s.ct}>Annual Return by Calendar Year</div>
              <div style={{overflowX:"auto"}}>
                <table style={s.tbl}>
                  <thead><tr><th style={s.thL}>Year</th><th style={s.th}>Calendar Return %</th><th style={s.th}>Result</th></tr></thead>
                  <tbody>{calYear.map(r=>(<tr key={r.year}><td style={s.tdL}>{r.year}</td><td style={{...s.td,...cv(r.ret)}}>{fmt(r.ret)}%</td><td style={{...s.td,color:r.ret>=0?t.green:t.red}}>{r.ret>=0?"▲ Positive":"▼ Negative"}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* BEST/WORST */}
        {activeTab==="Best/Worst"&&bestWorst&&(
          <div style={s.card}>
            <div style={s.ct}>Best &amp; Worst Periods</div>
            <div style={{overflowX:"auto"}}>
              <table style={s.tbl}>
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

        {/* ROLLING RETURNS */}
        {activeTab==="Rolling Returns"&&(
          <div style={s.card}>
            <div style={{...s.ct,marginBottom:14}}>Rolling Returns (CAGR)</div>
            <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
              {[1,3,5,7,10,12,15].map(y=>(
                <button key={y} onClick={()=>setRollingYears(y)} style={{padding:"5px 16px",borderRadius:20,border:`1px solid ${rollingYears===y?t.accent:t.border}`,backgroundColor:rollingYears===y?t.accent:t.chip,color:rollingYears===y?"#fff":t.text,cursor:"pointer",fontSize:13,fontWeight:rollingYears===y?600:400}}>{y}Y</button>
              ))}
            </div>
            <div style={{height:300}}><RollingChart data={rollingData} t={t}/></div>
            {rollingData?.length>0&&(
              <div style={{display:"flex",gap:12,marginTop:18,flexWrap:"wrap"}}>
                {[{label:"Min CAGR",val:Math.min(...rollingData.map(d=>d.cagr)),color:t.red},{label:"Max CAGR",val:Math.max(...rollingData.map(d=>d.cagr)),color:t.green},{label:"Avg CAGR",val:rollingData.reduce((a,b)=>a+b.cagr,0)/rollingData.length,color:t.accent},{label:"% Positive",val:rollingData.filter(d=>d.cagr>0).length/rollingData.length*100,color:t.green,suffix:"%"},{label:"Data Points",val:rollingData.length,color:t.textSub,suffix:""}].map(m=>(
                  <div key={m.label} style={s.mb}><div style={s.ml}>{m.label}</div><div style={{...s.mv,color:m.color,fontSize:18}}>{typeof m.val==="number"?fmt(m.val):m.val}{m.suffix??"%"}</div></div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MONTHLY HEATMAP */}
        {activeTab==="Monthly Heatmap"&&(
          <div style={s.card}>
            <div style={s.ct}>Monthly Returns Heatmap</div>
            <div style={{overflowX:"auto"}}>
              <table style={{...s.tbl,minWidth:780}}>
                <thead><tr><th style={s.thL}>YEAR</th>{MONTHS.map(m=><th key={m} style={s.th}>{m}</th>)}<th style={s.th}>TOTAL</th></tr></thead>
                <tbody>
                  {Object.keys(monthly).sort().reverse().map(year=>{
                    const total=Object.values(monthly[year]).reduce((a,b)=>a+b,0);
                    return(
                      <tr key={year}>
                        <td style={s.tdL}>{year}</td>
                        {[...Array(12)].map((_,mi)=>{const v=monthly[year][mi];const intensity=Math.min(Math.abs(v??0)/15,1);const bg=v==null?"transparent":v>=0?`rgba(22,163,74,${0.08+intensity*0.5})`:`rgba(220,38,38,${0.08+intensity*0.5})`;return(<td key={mi} title={v!=null?`${MONTHS[mi]} ${year}: ${fmt(v)}%`:undefined} style={{...s.td,backgroundColor:bg,color:v==null?t.textMuted:v>=0?t.green:t.red,fontWeight:500,fontSize:12}}>{v!=null?fmt(v):"--"}</td>);})}
                        <td style={{...s.td,...cv(total),fontWeight:700}}>{fmt(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SIP CALCULATOR */}
        {activeTab==="SIP Calculator"&&(
          <div style={s.card}>
            <div style={s.ct}>SIP &amp; Lumpsum Calculator</div>
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
                  {[{label:"Total Invested",val:fmtCr(sipResult.invested),color:t.text},{label:"SIP Corpus",val:fmtCr(sipResult.sipFV),color:t.green},{label:"Lumpsum Corpus",val:fmtCr(sipResult.lsFV),color:t.green},{label:"Total Corpus",val:fmtCr(sipResult.total),color:t.accent},{label:"Estimated Gain",val:fmtCr(sipResult.gain),color:sipResult.gain>=0?t.green:t.red},{label:"Applied CAGR",val:pct(sipResult.cagr),color:t.text},{label:"Wealth Multiplier",val:fmt(sipResult.total/sipResult.invested,2)+"x",color:t.accent}].map(m=>(<div key={m.label} style={s.mb}><div style={s.ml}>{m.label}</div><div style={{...s.mv,color:m.color}}>{m.val}</div></div>))}
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

        {/* COMPARE */}
        {activeTab==="Compare"&&(
          <div>
            <div style={{...s.card,marginBottom:16}}>
              <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center",marginBottom:16}}>
                {cmpFunds.map((f,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:6,backgroundColor:t.bg,border:`1.5px solid ${CC[i%CC.length]}`,borderRadius:20,padding:"5px 12px",fontSize:12,fontWeight:500}}>
                    <span style={{width:8,height:8,borderRadius:"50%",backgroundColor:CC[i%CC.length],display:"inline-block"}}/>
                    <span style={{maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span>
                    <span onClick={()=>setCmpFunds(p=>p.filter((_,idx)=>idx!==i))} style={{cursor:"pointer",color:t.textMuted,fontSize:16,marginLeft:2,lineHeight:1}}>×</span>
                  </div>
                ))}
                {cmpFunds.length<6&&(
                  <div ref={cmpSearchRef} style={{position:"relative",flex:"1 1 240px",minWidth:200}}>
                    <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:t.textMuted,fontSize:13,pointerEvents:"none"}}>🔍</span>
                    <input style={{...s.si,paddingLeft:34,fontSize:13}} placeholder="+ Add another fund to compare…" value={cmpQuery} onChange={e=>handleCmpSearch(e.target.value)}/>
                    <Dropdown items={cmpSugg} onSelect={addCmpFund} styles={s} t={t}/>
                  </div>
                )}
                {cmpLoading&&<span style={{color:t.textMuted,fontSize:12}}>Loading…</span>}
              </div>
              {cmpFunds.length<2&&<div style={{color:t.textMuted,fontSize:13}}>👆 Add at least 2 funds to compare. Current fund is pre-loaded.</div>}
            </div>

            {cmpFunds.length>=2&&(
              <>
                <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                  {["NAV","Returns","Risk","Best/Worst","Rolling"].map(ct=>(
                    <button key={ct} onClick={()=>setCmpTab(ct)} style={{padding:"7px 18px",borderRadius:8,border:`1px solid ${cmpTab===ct?t.accent:t.border}`,backgroundColor:cmpTab===ct?t.accent:t.chip,color:cmpTab===ct?"#fff":t.text,cursor:"pointer",fontSize:13,fontWeight:cmpTab===ct?600:400}}>{ct}</button>
                  ))}
                </div>

                {cmpTab==="NAV"&&(cmpRebased?(
                  <div style={s.card}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:16}}>
                      <div><div style={s.ct}>NAV (Rebased to 100)</div><div style={{fontSize:12,color:t.textMuted}}>Common range: {cmpRebased.startDate} → {cmpRebased.endDate}</div></div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
                        {cmpRebased.series.map((s2,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}><span style={{width:20,height:3,backgroundColor:s2.color,display:"inline-block",borderRadius:2}}/><span style={{maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.textSub}}>{s2.name.split("–")[0].trim()}</span></div>))}
                      </div>
                    </div>
                    <div style={{height:340}}><CompareChart series={cmpRebased.series} t={t}/></div>
                  </div>
                ):<div style={{...s.card,color:t.textMuted,textAlign:"center",padding:40}}>No common date range found between these funds.</div>)}

                {cmpTab==="Returns"&&(
                  <div style={s.card}>
                    <div style={s.ct}>Returns Comparison</div>
                    <div style={{overflowX:"auto"}}>
                      <table style={s.tbl}>
                        <thead><tr><th style={s.thL}>Fund</th>{["1D","1M","3M","6M","1Y CAGR","3Y CAGR","5Y CAGR","Since Inception"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                        <tbody>{cmpFunds.map((f,i)=>{const st=cmpStats[i];if(!st)return null;const nowTs=Date.now();
                          return(<tr key={i}><td style={{...s.tdL,maxWidth:220}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",backgroundColor:CC[i%CC.length],flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span></div></td>
                          {[st.ret1d,
                            (()=>{const n=navAtTs(f.asc,nowTs-30*86400000);return n?(st.latest-n)/n*100:null;})(),
                            (()=>{const n=navAtTs(f.asc,nowTs-91*86400000);return n?(st.latest-n)/n*100:null;})(),
                            (()=>{const n=navAtTs(f.asc,nowTs-182*86400000);return n?(st.latest-n)/n*100:null;})(),
                            st.ret1y,st.cagr3y,st.cagr5y,st.cagrAll
                          ].map((v,j)=><td key={j} style={{...s.td,...cv(v)}}>{pct(v)}</td>)}</tr>);
                        })}</tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cmpTab==="Risk"&&(
                  <div style={s.card}>
                    <div style={s.ct}>Risk Metrics Comparison</div>
                    <div style={{overflowX:"auto"}}>
                      <table style={s.tbl}>
                        <thead><tr><th style={s.thL}>Fund</th>{["Sharpe (3Y)","Sortino (3Y)","Std Dev %","Max Drawdown"].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
                        <tbody>{cmpFunds.map((f,i)=>{const st=cmpStats[i];if(!st)return null;return(<tr key={i}><td style={{...s.tdL,maxWidth:220}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",backgroundColor:CC[i%CC.length],flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span></div></td><td style={{...s.td,color:(st.sharpe??0)>=1?t.green:t.textSub,fontWeight:600}}>{st.sharpe!=null?fmt(st.sharpe):"--"}</td><td style={{...s.td,color:(st.sortino??0)>=1?t.green:t.textSub,fontWeight:600}}>{st.sortino!=null?fmt(st.sortino):"--"}</td><td style={{...s.td,color:t.textSub}}>{st.stdDev!=null?fmt(st.stdDev)+"%":"--"}</td><td style={{...s.td,color:t.red,fontWeight:600}}>{pct(st.maxDD)}</td></tr>);})}</tbody>
                      </table>
                    </div>
                  </div>
                )}

                {cmpTab==="Best/Worst"&&(
                  <div style={s.card}>
                    <div style={s.ct}>Best &amp; Worst Periods Comparison</div>
                    {["week","month","quarter","year"].map(period=>(
                      <div key={period} style={{marginBottom:20}}>
                        <div style={{fontSize:13,fontWeight:600,color:t.textSub,textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:10}}>{period}</div>
                        <div style={{overflowX:"auto"}}>
                          <table style={s.tbl}>
                            <thead><tr><th style={s.thL}>Fund</th><th style={{...s.th,color:t.green}}>Best Return</th><th style={s.th}>Best Period</th><th style={{...s.th,color:t.red}}>Worst Return</th><th style={s.th}>Worst Period</th></tr></thead>
                            <tbody>{cmpFunds.map((f,i)=>{const bw=cmpBW[i]?.[period];if(!bw)return null;return(<tr key={i}><td style={{...s.tdL,maxWidth:200}}><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",backgroundColor:CC[i%CC.length],flexShrink:0}}/><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name}</span></div></td><td style={{...s.td,color:t.green,fontWeight:600}}>{bw.best?fmt(bw.best.ret)+"%":"--"}</td><td style={{...s.td,color:t.textMuted,fontSize:11}}>{bw.best?`${bw.best.begin} → ${bw.best.end}`:"--"}</td><td style={{...s.td,color:t.red,fontWeight:600}}>{bw.worst?fmt(bw.worst.ret)+"%":"--"}</td><td style={{...s.td,color:t.textMuted,fontSize:11}}>{bw.worst?`${bw.worst.begin} → ${bw.worst.end}`:"--"}</td></tr>);})}</tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {cmpTab==="Rolling"&&(
                  <div style={s.card}>
                    <div style={{...s.ct,marginBottom:12}}>Rolling Returns Comparison (CAGR)</div>
                    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                      {[1,3,5,7,10].map(y=>(<button key={y} onClick={()=>setCmpRollingYrs(y)} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${cmpRollingYrs===y?t.accent:t.border}`,backgroundColor:cmpRollingYrs===y?t.accent:t.chip,color:cmpRollingYrs===y?"#fff":t.text,cursor:"pointer",fontSize:13,fontWeight:cmpRollingYrs===y?600:400}}>{y}Y</button>))}
                    </div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:14}}>
                      {cmpFunds.map((f,i)=>(<div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:12}}><span style={{width:20,height:3,backgroundColor:CC[i%CC.length],display:"inline-block",borderRadius:2}}/><span style={{color:t.textSub,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.meta?.scheme_name?.split("–")[0].trim()}</span></div>))}
                    </div>
                    <div style={{height:300}}><CompareRollingChart series={cmpRolling} t={t}/></div>
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
