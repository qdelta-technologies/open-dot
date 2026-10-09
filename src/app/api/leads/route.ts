import { leadsCsv, listLeads } from "@/server/leads";

// Saved leads, as a spreadsheet (CSV) or JSON. Needs the normal sign-in like the rest of the app.
export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format");
  if (format === "json") return Response.json({ leads: listLeads(500) });
  return new Response(`﻿${leadsCsv()}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="qdot-leads.csv"',
      "Cache-Control": "no-store",
    },
  });
}
