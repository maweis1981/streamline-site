import{t,b as f,a as y,s as k,p as $,w as S,e as L}from"./store.js";const c=document.getElementById("doubo-tool"),q=c.dataset.webUrl??"/web/";c.innerHTML=`
  <form class="tl-form card gborder">
    <label>${t("input_url")}<input name="url" type="url" inputmode="url" placeholder="https://example.com/playlist.m3u"></label>
    <label>${t("input_file")}<input name="file" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"></label>
    <details><summary>${t("input_text")}</summary><textarea name="text" rows="6" spellcheck="false"></textarea></details>
    <div class="tl-actions"><button type="submit" class="btn btn-primary">${t("analyze")}</button><span class="tl-msg" role="status"></span></div>
    <p class="tl-note">${t("privacy")}</p>
  </form>
  <div class="tl-result" hidden>
    <dl class="tl-stats"></dl>
    <div class="tl-cols">
      <section class="card tl-groups"><h2>${t("groups_title")}</h2><table><thead><tr><th>${t("group_col")}</th><th>${t("channels_col")}</th></tr></thead><tbody></tbody></table></section>
      <section class="card tl-clean">
        <h2>${t("clean_title")}</h2>
        <label><input type="checkbox" name="dedupe" checked> ${t("opt_dedupe")}</label>
        <label><input type="checkbox" name="sort" checked> ${t("opt_sort")}</label>
        <label><input type="checkbox" name="https"> ${t("opt_https")}</label>
        <p class="tl-out"></p>
        <div class="tl-actions">
          <button type="button" class="btn btn-primary" data-action="download">${t("download")}</button>
          <button type="button" class="btn btn-ghost" data-action="web">${t("open_web")}</button>
        </div>
      </section>
    </div>
  </div>`;const w=c.querySelector(".tl-form"),m=c.querySelector(".tl-msg"),E=c.querySelector(".tl-result"),_=c.querySelector(".tl-clean");let r=[],p="playlist";const i=new Intl.NumberFormat(document.documentElement.lang||void 0),g=n=>n.replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e]),b=n=>(n.attrs["group-title"]??"").split(";")[0].trim();function M(n){if(r=L(n),!r.length)return!1;const e=new Map;for(const l of r)e.set(l.url,(e.get(l.url)??0)+1);const a=r.length-e.size,s=$(n),o=new Map;for(const l of s)o.set(l.group||"—",(o.get(l.group||"—")??0)+1);const u=l=>`${i.format(l)} <small>(${Math.round(l/r.length*100)}%)</small>`,x=[[t("stat_entries"),i.format(r.length)],[t("stat_channels"),i.format(s.length)],[t("stat_groups"),i.format(o.size)],[t("stat_duplicates"),i.format(a)],[t("stat_https"),u(r.filter(l=>l.url.startsWith("https://")).length)],[t("stat_logos"),u(r.filter(l=>l.attrs["tvg-logo"]).length)],[t("stat_tvgid"),u(r.filter(l=>l.attrs["tvg-id"]).length)],[t("stat_multi"),i.format(s.filter(l=>l.routes.length>1).length)]];return c.querySelector(".tl-stats").innerHTML=x.map(([l,d])=>`<div class="card"><dt>${g(l)}</dt><dd>${d}</dd></div>`).join(""),c.querySelector(".tl-groups tbody").innerHTML=[...o.entries()].sort((l,d)=>d[1]-l[1]).map(([l,d])=>`<tr><td>${g(l)}</td><td>${i.format(d)}</td></tr>`).join(""),E.hidden=!1,v(),y("tool_m3u_analyze",{entries:r.length}),!0}function h(){const n=a=>_.querySelector(`[name="${a}"]`).checked;let e=r;if(n("https")&&(e=e.filter(a=>a.url.startsWith("https://"))),n("dedupe")){const a=new Set;e=e.filter(s=>!a.has(s.url)&&!!a.add(s.url))}return n("sort")&&(e=[...e].sort((a,s)=>b(a).localeCompare(b(s))||a.title.localeCompare(s.title))),e}function v(){c.querySelector(".tl-out").textContent=`${t("stat_entries")}: ${i.format(r.length)} → ${i.format(h().length)}`}async function z(){var o;const n=new FormData(w),e=n.get("file"),a=String(n.get("text")??"").trim(),s=String(n.get("url")??"").trim();if(e&&e.size)return p=e.name.replace(/\.m3u8?$/i,""),e.text();if(a)return p="playlist",a;if(s){p=((o=s.split("/").pop())==null?void 0:o.replace(/\.m3u8?$/i,""))||"playlist";const u=await fetch(s,{credentials:"omit"});if(!u.ok)throw new Error(String(u.status));return u.text()}return null}w.addEventListener("submit",async n=>{n.preventDefault(),m.textContent=t("loading");try{const e=await z();if(e===null)return void(m.textContent=t("need_input"));m.textContent=M(e)?"":t("no_channels")}catch{m.textContent=t("url_blocked")}});_.addEventListener("change",v);c.addEventListener("click",async n=>{var a;const e=(a=n.target.closest("[data-action]"))==null?void 0:a.dataset.action;if(e==="download"){const s=new Blob([f(h())],{type:"audio/x-mpegurl"}),o=Object.assign(document.createElement("a"),{href:URL.createObjectURL(s),download:`${p}-clean.m3u`});o.click(),setTimeout(()=>URL.revokeObjectURL(o.href),1e3),y("tool_m3u_download",{entries:h().length})}if(e==="web"){const s=f(h()),o=`${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;await k({id:o,name:p,source:{kind:"text"},channels:$(s),importedAt:Date.now()}),S("source",o),location.href=q}});
