"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { deleteTemplateAction, getTemplates, saveTemplateAction } from "@/app/actions";

type Template = Awaited<ReturnType<typeof getTemplates>>[number];

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Message templates for email and WhatsApp. {name}, {first_name} and {company} are filled in for each lead. */
export default function TemplatesSection() {
  const [items, setItems] = useState<Template[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", purpose: "", subject: "", body: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => getTemplates().then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    load();
  }, [load]);

  if (!items) return <div className="surface animate-pulse h-20 rounded-lg" />;

  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await saveTemplateAction(form.name, form.subject, form.body, form.purpose);
    setSaving(false);
    if (err) return setError(err);
    setForm({ name: "", purpose: "", subject: "", body: "" });
    load();
  };

  const editing = items.some((t) => t.name.toLowerCase() === form.name.trim().toLowerCase());

  return (
    <div className="space-y-3">
      {items.length === 0 && <div className="surface px-4 py-4 text-body-sm text-foreground/55">No templates yet. Add one below, or tell a dot: &ldquo;save this as Template 1&rdquo;.</div>}

      {items.length > 0 && (
        <div className="surface divide-y divide-black/[0.06]">
          {items.map((t) => {
            const isOpen = open === t.id;
            return (
              <div key={t.id}>
                <div className="flex items-start gap-2 px-4 py-3">
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.id)} className="group flex min-w-0 flex-1 items-start gap-2 text-left">
                    <ChevronDown className={`mt-1 size-4 shrink-0 text-foreground/45 transition-transform duration-200 group-hover:text-foreground ${isOpen ? "" : "-rotate-90"}`} strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px]">{t.name}</span>
                        <span className="rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] text-foreground/60">{t.subject ? "Email" : "WhatsApp / message"}</span>
                      </span>
                      <span className="block truncate text-caption text-foreground/55">{t.purpose ? `For: ${t.purpose}` : "No purpose written yet"}</span>
                      <span className="block text-[11px] text-foreground/40">Updated {when(t.updatedAt)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Edit ${t.name}`}
                    className="mt-0.5 text-foreground/45 hover:text-foreground"
                    onClick={() => setForm({ name: t.name, purpose: t.purpose, subject: t.subject, body: t.body })}
                  >
                    <Pencil className="size-4" strokeWidth={1.75} />
                  </button>
                  <button type="button" aria-label={`Delete ${t.name}`} className="mt-0.5 text-foreground/45 hover:text-destructive" onClick={() => deleteTemplateAction(t.id).then(load)}>
                    <Trash2 className="size-4" strokeWidth={1.75} />
                  </button>
                </div>
                {isOpen && (
                  <div className="space-y-1 px-4 pb-3 pl-10">
                    {t.subject && <div className="text-body-sm text-foreground/70">Subject: {t.subject}</div>}
                    <div className="whitespace-pre-wrap text-body-sm text-foreground/65">{t.body}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="surface space-y-2 px-4 py-3">
        <div className="text-[14px]">{editing ? "Edit template" : "New template"}</div>
        <input className="field" placeholder="Name, e.g. Template 1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="field" placeholder="What it is for, e.g. First email to agencies" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
        <input className="field" placeholder="Email subject (leave empty for WhatsApp)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <textarea
          className="field min-h-28"
          placeholder={"Message. Use {first_name}, {name} and {company} where each lead's details go."}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
        {error && <div className="text-caption text-destructive">{error}</div>}
        <button type="button" className="btn-secondary" disabled={saving || !form.name.trim() || !form.body.trim()} onClick={save}>
          Save template
        </button>
      </div>
    </div>
  );
}
