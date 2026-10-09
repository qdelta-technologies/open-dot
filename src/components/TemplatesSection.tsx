"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteTemplateAction, getTemplates, saveTemplateAction } from "@/app/actions";

type Template = Awaited<ReturnType<typeof getTemplates>>[number];

/** Message templates for email and WhatsApp. {name}, {first_name} and {company} are filled in for each lead. */
export default function TemplatesSection() {
  const [items, setItems] = useState<Template[] | null>(null);
  const [form, setForm] = useState({ name: "", subject: "", body: "" });
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
    const err = await saveTemplateAction(form.name, form.subject, form.body);
    setSaving(false);
    if (err) return setError(err);
    setForm({ name: "", subject: "", body: "" });
    load();
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && <div className="surface px-4 py-4 text-body-sm text-foreground/55">No templates yet. Add one below, or tell a dot: &ldquo;save this as Template 1&rdquo;.</div>}
      {items.map((t) => (
        <div key={t.id} className="surface px-4 py-3">
          <div className="flex items-start gap-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setForm({ name: t.name, subject: t.subject, body: t.body })}
              title="Edit this template"
            >
              <div className="text-[14px]">{t.name}</div>
              {t.subject && <div className="truncate text-caption text-foreground/55">Subject: {t.subject}</div>}
              <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-body-sm text-foreground/60">{t.body}</div>
            </button>
            <button
              type="button"
              aria-label={`Delete ${t.name}`}
              className="text-foreground/45 hover:text-destructive"
              onClick={() => deleteTemplateAction(t.id).then(load)}
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ))}

      <div className="surface space-y-2 px-4 py-3">
        <div className="text-[14px]">{items.some((t) => t.name.toLowerCase() === form.name.trim().toLowerCase()) ? "Edit template" : "New template"}</div>
        <input className="field" placeholder="Name, e.g. Template 1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
