"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { parseAdName } from "@/lib/naming";
import { Card, PageHeader, Button, Badge, SectionTitle } from "@/components/ui";

interface AdRow {
  adName: string;
  spend: number;
  impressions: number;
  leads: number;
  flow: string | null;
}

interface Mapping {
  id: string;
  adName: string;
  personaCode: string | null;
  hookCode: string | null;
  bodyCode: string | null;
  angleCode: string | null;
  format: string | null;
  flow: string | null;
  note: string | null;
}

interface ParamOption { id: string; code: string | null; name: string }

function isRecognized(adName: string): boolean {
  const p = parseAdName(adName);
  return !!(p.personaCode || p.hookCode || p.bodyCode || p.angleCode);
}

function EditRow({
  adRow, existing, personas, hooks, bodies, angles,
  onSave, onDelete,
}: {
  adRow: AdRow;
  existing: Mapping | null;
  personas: ParamOption[];
  hooks: ParamOption[];
  bodies: ParamOption[];
  angles: ParamOption[];
  onSave: (m: Omit<Mapping, "id">) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    personaCode: existing?.personaCode ?? "",
    hookCode:    existing?.hookCode    ?? "",
    bodyCode:    existing?.bodyCode    ?? "",
    angleCode:   existing?.angleCode   ?? "",
    format:      existing?.format      ?? "",
    flow:        existing?.flow        ?? "",
    note:        existing?.note        ?? "",
  });

  useEffect(() => {
    setForm({
      personaCode: existing?.personaCode ?? "",
      hookCode:    existing?.hookCode    ?? "",
      bodyCode:    existing?.bodyCode    ?? "",
      angleCode:   existing?.angleCode   ?? "",
      format:      existing?.format      ?? "",
      flow:        existing?.flow        ?? "",
      note:        existing?.note        ?? "",
    });
  }, [existing]);

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    await onSave({ adName: adRow.adName, ...form,
      personaCode: form.personaCode || null,
      hookCode:    form.hookCode    || null,
      bodyCode:    form.bodyCode    || null,
      angleCode:   form.angleCode   || null,
      format:      form.format      || null,
      flow:        form.flow        || null,
      note:        form.note        || null,
    });
    setSaving(false);
    setOpen(false);
  };

  const mapped = !!existing;
  const recognized = isRecognized(adRow.adName);

  return (
    <Card style={{
      border: recognized
        ? "1px solid rgba(110,200,160,0.15)"
        : mapped
        ? "1px solid rgba(72,184,208,0.2)"
        : "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Status dot */}
        <div style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: recognized ? "#6EC8A0" : mapped ? "#48B8D0" : "#444",
        }} />

        {/* Ad name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#CCC", fontFamily: "monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {adRow.adName}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#555" }}>€{adRow.spend.toFixed(0)} спенд</span>
            <span style={{ fontSize: 10, color: "#555" }}>{adRow.impressions.toLocaleString()} показов</span>
            {adRow.leads > 0 && <span style={{ fontSize: 10, color: "#6EC8A0" }}>{adRow.leads} лидов</span>}
            {adRow.flow && <Badge color={adRow.flow === "com" ? "#E8AA42" : "#48B8D0"}>{adRow.flow.toUpperCase()}</Badge>}
          </div>
        </div>

        {/* Codes */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 160 }}>
          {recognized ? (
            (() => {
              const p = parseAdName(adRow.adName);
              return (
                <>
                  {p.personaCode && <Badge color="#48B8D0">{p.personaCode}</Badge>}
                  {p.hookCode    && <Badge color="#C490D1">{p.hookCode}</Badge>}
                  {p.bodyCode    && <Badge color="#6EC8A0">{p.bodyCode}</Badge>}
                  {p.angleCode   && <Badge color="#FF8B5A">{p.angleCode}</Badge>}
                  <Badge color="#6EC8A0">авто</Badge>
                </>
              );
            })()
          ) : mapped ? (
            <>
              {existing.personaCode && <Badge color="#48B8D0">{existing.personaCode}</Badge>}
              {existing.hookCode    && <Badge color="#C490D1">{existing.hookCode}</Badge>}
              {existing.bodyCode    && <Badge color="#6EC8A0">{existing.bodyCode}</Badge>}
              {existing.angleCode   && <Badge color="#FF8B5A">{existing.angleCode}</Badge>}
              <Badge color="#48B8D0">маппинг</Badge>
            </>
          ) : (
            <span style={{ fontSize: 11, color: "#444" }}>не распознано</span>
          )}
        </div>

        {/* Actions */}
        {!recognized && (
          <Button size="sm" onClick={() => setOpen(!open)}>
            {open ? "Закрыть" : mapped ? "Изменить" : "+ Назначить"}
          </Button>
        )}
        {!recognized && mapped && !open && (
          <Button size="sm" variant="danger" onClick={() => onDelete(existing!.id)}>✕</Button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr) 1fr 1fr", gap: 8, marginBottom: 8 }}>
            {([
              ["personaCode", "Персона", personas, "#48B8D0"],
              ["hookCode",    "Хук",     hooks,    "#C490D1"],
              ["bodyCode",    "Боди",    bodies,   "#6EC8A0"],
              ["angleCode",   "Энгл",    angles,   "#FF8B5A"],
            ] as [string, string, ParamOption[], string][]).map(([key, label, opts, color]) => (
              <div key={key}>
                <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                <select
                  value={form[key as keyof typeof form]}
                  onChange={f(key)}
                  style={{ background: "#1a1a1a", border: `1px solid ${color}30`, color: "#ccc",
                    borderRadius: 6, padding: "4px 8px", fontSize: 11, width: "100%" }}
                >
                  <option value="">—</option>
                  {opts.filter(o => o.code).map(o => (
                    <option key={o.id} value={o.code!}>{o.code} — {o.name}</option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#E8AA42", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Формат</div>
              <select value={form.format} onChange={f("format")}
                style={{ background: "#1a1a1a", border: "1px solid rgba(232,170,66,0.3)", color: "#ccc",
                  borderRadius: 6, padding: "4px 8px", fontSize: 11, width: "100%" }}>
                <option value="">—</option>
                {["ugc","static","animation","human","mixed"].map(v => (
                  <option key={v} value={v}>{v.toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#777", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Поток</div>
              <select value={form.flow} onChange={f("flow")}
                style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.1)", color: "#ccc",
                  borderRadius: 6, padding: "4px 8px", fontSize: 11, width: "100%" }}>
                <option value="">—</option>
                <option value="com">COM</option>
                <option value="gov">GOV</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <input
              value={form.note}
              onChange={f("note")}
              placeholder="Заметка (необязательно)"
              style={{ fontSize: 11, padding: "5px 10px" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button size="sm" onClick={() => setOpen(false)}>Отмена</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? "Сохраняю..." : "Сохранить маппинг"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function MappingPage() {
  const [ads, setAds] = useState<AdRow[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [personas, setPersonas] = useState<ParamOption[]>([]);
  const [hooks, setHooks] = useState<ParamOption[]>([]);
  const [bodies, setBodies] = useState<ParamOption[]>([]);
  const [angles, setAngles] = useState<ParamOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unmapped" | "mapped">("unmapped");

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [perfRes, mappingRes, pRes, hRes, bRes, aRes] = await Promise.all([
      supabase.from("creative_performance")
        .select("ad_name, spend, impressions, leads, flow")
        .order("spend", { ascending: false })
        .limit(500),
      fetch("/api/analytics/mapping").then(r => r.json()),
      supabase.from("personas").select("id, code, name").order("code"),
      supabase.from("hooks").select("id, code, name").order("code"),
      supabase.from("bodies").select("id, code, name").order("code"),
      supabase.from("angles").select("id, code, name").order("code"),
    ]);

    // Дедупликация по adName — одно имя может появляться с разными ad_id
    const byName = new Map<string, AdRow>();
    for (const r of (perfRes.data ?? [])) {
      const name = r.ad_name as string;
      const existing = byName.get(name);
      if (existing) {
        existing.spend       += Number(r.spend) || 0;
        existing.impressions += Number(r.impressions) || 0;
        existing.leads       += Number(r.leads) || 0;
      } else {
        byName.set(name, {
          adName:      name,
          spend:       Number(r.spend) || 0,
          impressions: Number(r.impressions) || 0,
          leads:       Number(r.leads) || 0,
          flow:        r.flow,
        });
      }
    }
    setAds(Array.from(byName.values()));
    setMappings(mappingRes.mappings ?? []);
    setPersonas(pRes.data ?? []);
    setHooks(hRes.data ?? []);
    setBodies(bRes.data ?? []);
    setAngles(aRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleSave = async (m: Omit<Mapping, "id">) => {
    await fetch("/api/analytics/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(m),
    });
    await loadAll();
  };

  const handleDelete = async (id: string) => {
    await fetch("/api/analytics/mapping", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadAll();
  };

  const mappingByName = Object.fromEntries(mappings.map(m => [m.adName.trim().toLowerCase(), m]));

  const filtered = ads.filter(a => {
    const rec = isRecognized(a.adName);
    const mapped = !!mappingByName[a.adName.trim().toLowerCase()];
    if (filter === "unmapped") return !rec && !mapped;
    if (filter === "mapped") return !rec && mapped;
    return true;
  });

  const unmappedCount = ads.filter(a => !isRecognized(a.adName) && !mappingByName[a.adName.trim().toLowerCase()]).length;
  const mappedCount = ads.filter(a => !isRecognized(a.adName) && mappingByName[a.adName.trim().toLowerCase()]).length;
  const autoCount = ads.filter(a => isRecognized(a.adName)).length;

  return (
    <div>
      <PageHeader
        title="Маппинг объявлений"
        subtitle="Назначьте коды параметров старым объявлениям из Meta"
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Авто-распознано", value: autoCount, color: "#6EC8A0", desc: "Соответствуют нэймингу P-H-B-A" },
          { label: "Назначено вручную", value: mappedCount, color: "#48B8D0", desc: "Маппинг настроен" },
          { label: "Не распознано", value: unmappedCount, color: "#E8AA42", desc: "Требует маппинга" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{s.label}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>{s.desc}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {([
          ["unmapped", `Нераспознанные (${unmappedCount})`, "#E8AA42"],
          ["mapped",   `С маппингом (${mappedCount})`,     "#48B8D0"],
          ["all",      `Все (${ads.length})`,              "#777"],
        ] as const).map(([v, l, color]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding: "7px 16px", borderRadius: 8, fontSize: 12, cursor: "pointer",
            fontWeight: filter === v ? 700 : 400, fontFamily: "inherit",
            border: filter === v ? `1px solid ${color}40` : "1px solid rgba(255,255,255,0.06)",
            background: filter === v ? `${color}10` : "rgba(255,255,255,0.02)",
            color: filter === v ? color : "#666",
          }}>{l}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#444", padding: 60 }}>Загрузка...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <div style={{ textAlign: "center", padding: "40px 0", color: "#555" }}>
            {filter === "unmapped" ? "Все объявления уже распознаны или замаплены" : "Нет записей"}
          </div>
        </Card>
      ) : (
        <>
          <SectionTitle icon="🗂">
            {filtered.length} объявлений
          </SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filtered.map(a => (
              <EditRow
                key={a.adName}
                adRow={a}
                existing={mappingByName[a.adName.trim().toLowerCase()] ?? null}
                personas={personas}
                hooks={hooks}
                bodies={bodies}
                angles={angles}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
