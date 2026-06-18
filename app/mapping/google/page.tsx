"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Card, PageHeader, Button, Badge } from "@/components/ui";

interface Asset {
  adId: string;
  adName: string;
  objectType: string;       // IMAGE | VIDEO
  flow: string | null;
  thumbnailUrl: string | null;
  videoId: string | null;
}
interface Mapping {
  id: string;
  adName: string;
  personaCode: string | null;
  hookCode: string | null;
  bodyCode: string | null;
  angleCode: string | null;
  flow: string | null;
}
interface ParamOption { code: string | null; name: string }

const PARAM_COLOR = { persona: "#48B8D0", hook: "#C490D1", body: "#6EC8A0", angle: "#FF8B5A" };

export default function GoogleMappingPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [mapByName, setMapByName] = useState<Record<string, Mapping>>({});
  const [personas, setPersonas] = useState<ParamOption[]>([]);
  const [hooks, setHooks] = useState<ParamOption[]>([]);
  const [bodies, setBodies] = useState<ParamOption[]>([]);
  const [angles, setAngles] = useState<ParamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "unmapped" | "mapped">("unmapped");
  const [typeFilter, setTypeFilter] = useState<"all" | "IMAGE" | "VIDEO">("all");
  const [limit, setLimit] = useState(60);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [creRes, mapRes, pRes, hRes, bRes, aRes] = await Promise.all([
      supabase.from("meta_creatives")
        .select("ad_id, ad_name, object_type, flow, thumbnail_url, video_id")
        .eq("platform", "google").order("ad_name"),
      fetch("/api/analytics/mapping").then(r => r.json()),
      supabase.from("personas").select("code, name").order("code"),
      supabase.from("hooks").select("code, name").order("code"),
      supabase.from("bodies").select("code, name").order("code"),
      supabase.from("angles").select("code, name").order("code"),
    ]);
    setAssets((creRes.data ?? []).map((r: Record<string, unknown>) => ({
      adId: r.ad_id as string, adName: r.ad_name as string, objectType: (r.object_type as string) ?? "IMAGE",
      flow: r.flow as string | null, thumbnailUrl: r.thumbnail_url as string | null, videoId: r.video_id as string | null,
    })));
    const gmap: Record<string, Mapping> = {};
    for (const m of (mapRes.mappings ?? []) as Mapping[]) {
      if (m.adName?.startsWith("gasset:")) gmap[m.adName] = m;
    }
    setMapByName(gmap);
    setPersonas(pRes.data ?? []); setHooks(hRes.data ?? []); setBodies(bRes.data ?? []); setAngles(aRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const pullAssets = async () => {
    setPulling(true);
    try { await fetch("/api/google/assets", { method: "POST" }); await loadAll(); }
    finally { setPulling(false); }
  };

  // Автосохранение одного кода для ассета.
  const setCode = async (asset: Asset, field: "personaCode" | "hookCode" | "bodyCode" | "angleCode", value: string) => {
    const cur = mapByName[asset.adId];
    const next: Mapping = {
      id: cur?.id ?? "", adName: asset.adId,
      personaCode: cur?.personaCode ?? null, hookCode: cur?.hookCode ?? null,
      bodyCode: cur?.bodyCode ?? null, angleCode: cur?.angleCode ?? null,
      flow: cur?.flow ?? asset.flow ?? null,
      [field]: value || null,
    };
    setMapByName(p => ({ ...p, [asset.adId]: next })); // оптимистично
    await fetch("/api/analytics/mapping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adName: asset.adId,
        personaCode: next.personaCode, hookCode: next.hookCode,
        bodyCode: next.bodyCode, angleCode: next.angleCode,
        format: asset.objectType === "VIDEO" ? "VIDEO" : "STATIC",
        flow: next.flow, note: "google-asset",
      }),
    });
  };

  const isMapped = (m?: Mapping) => !!(m && (m.personaCode || m.hookCode || m.bodyCode || m.angleCode));
  const mappedCount = assets.filter(a => isMapped(mapByName[a.adId])).length;
  const imgCount = assets.filter(a => a.objectType !== "VIDEO").length;
  const vidCount = assets.filter(a => a.objectType === "VIDEO").length;

  const filtered = assets.filter(a => {
    const mapped = isMapped(mapByName[a.adId]);
    if (statusFilter === "mapped" && !mapped) return false;
    if (statusFilter === "unmapped" && mapped) return false;
    if (typeFilter !== "all" && a.objectType !== typeFilter) return false;
    return true;
  });
  const shown = filtered.slice(0, limit);

  const Sel = ({ asset, field, opts }: { asset: Asset; field: "personaCode" | "hookCode" | "bodyCode" | "angleCode"; opts: ParamOption[] }) => {
    const m = mapByName[asset.adId];
    const val = m?.[field] ?? "";
    const color = PARAM_COLOR[field.replace("Code", "") as keyof typeof PARAM_COLOR];
    return (
      <select value={val} onChange={e => setCode(asset, field, e.target.value)} style={{
        fontSize: 11, padding: "3px 5px", borderRadius: 6, background: "#0d0f15",
        color: val ? color : "#666", border: `1px solid ${val ? color + "55" : "rgba(255,255,255,0.1)"}`,
        fontFamily: "inherit", cursor: "pointer", width: "100%",
      }}>
        <option value="">{field.replace("Code", "").toUpperCase()}</option>
        {opts.filter(o => o.code).map(o => <option key={o.code} value={o.code!}>{o.code} · {o.name}</option>)}
      </select>
    );
  };

  return (
    <div>
      <PageHeader
        title="Маппинг креативов Google"
        subtitle="Ассеты PMax/Demand Gen (картинки + YouTube) → коды P·H·B·A. Превью кликабельны."
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={pullAssets} disabled={pulling} style={{ background: "rgba(72,184,208,0.1)", border: "1px solid rgba(72,184,208,0.25)", color: pulling ? "#666" : "#48B8D0" }}>
              {pulling ? "⏳ Тяну ассеты…" : "⬇️ Подтянуть ассеты"}
            </Button>
            <Button onClick={loadAll} disabled={loading}>{loading ? "⏳" : "🔄 Обновить"}</Button>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
        {[
          { label: "Всего ассетов", value: assets.length, color: "#DDD", desc: `${imgCount} картинок · ${vidCount} видео` },
          { label: "Размечено", value: mappedCount, color: "#6EC8A0", desc: "Коды назначены" },
          { label: "Без кодов", value: assets.length - mappedCount, color: "#E8AA42", desc: "Требуют маппинга" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{s.label}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>{s.desc}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {([["unmapped", "Без кодов"], ["mapped", "Размечены"], ["all", "Все"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setStatusFilter(v)} style={btn(statusFilter === v, "#48B8D0")}>{l}</button>
        ))}
        <span style={{ width: 1, background: "rgba(255,255,255,0.08)", margin: "0 4px" }} />
        {([["all", "Все типы"], ["IMAGE", "🖼 Картинки"], ["VIDEO", "🎬 Видео"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTypeFilter(v)} style={btn(typeFilter === v, "#C490D1")}>{l}</button>
        ))}
      </div>

      {loading && <Card><div style={{ color: "#666", padding: 20, textAlign: "center" }}>Загрузка…</div></Card>}
      {!loading && assets.length === 0 && (
        <Card><div style={{ color: "#666", padding: 30, textAlign: "center" }}>Ассетов нет. Нажми «⬇️ Подтянуть ассеты».</div></Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
        {shown.map(a => {
          const mapped = isMapped(mapByName[a.adId]);
          return (
            <Card key={a.adId} style={{ padding: 10, border: mapped ? "1px solid rgba(110,200,160,0.3)" : "1px solid rgba(255,255,255,0.06)" }}>
              <a href={a.videoId ? `https://youtube.com/watch?v=${a.videoId}` : (a.thumbnailUrl ?? "#")} target="_blank" rel="noreferrer"
                 style={{ display: "block", position: "relative" }}>
                <img src={a.thumbnailUrl ?? ""} alt="" loading="lazy" style={{
                  width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8, background: "#0d0f15", display: "block",
                }} />
                <span style={{ position: "absolute", top: 6, left: 6, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 5,
                  background: "rgba(0,0,0,0.7)", color: a.objectType === "VIDEO" ? "#FF8B5A" : "#6EC8A0" }}>
                  {a.objectType === "VIDEO" ? "🎬 VIDEO" : "🖼 IMAGE"}
                </span>
                {a.flow && <span style={{ position: "absolute", top: 6, right: 6 }}><Badge color={a.flow === "com" ? "#E8AA42" : "#48B8D0"}>{a.flow.toUpperCase()}</Badge></span>}
              </a>
              <div title={a.adName} style={{ fontSize: 10, color: "#888", margin: "7px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.adName}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                <Sel asset={a} field="personaCode" opts={personas} />
                <Sel asset={a} field="hookCode" opts={hooks} />
                <Sel asset={a} field="bodyCode" opts={bodies} />
                <Sel asset={a} field="angleCode" opts={angles} />
              </div>
            </Card>
          );
        })}
      </div>

      {shown.length < filtered.length && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Button onClick={() => setLimit(l => l + 60)}>Показать ещё ({filtered.length - shown.length})</Button>
        </div>
      )}
    </div>
  );
}

function btn(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
    fontWeight: active ? 700 : 400,
    border: active ? `1px solid ${color}66` : "1px solid rgba(255,255,255,0.06)",
    background: active ? `${color}1A` : "rgba(255,255,255,0.02)",
    color: active ? color : "#666",
  };
}
