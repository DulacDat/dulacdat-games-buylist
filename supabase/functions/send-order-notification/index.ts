// Sends a Discord notification for a saved buylist batch.
// Required Supabase secrets: DISCORD_WEBHOOK_URL and SUPABASE_SERVICE_ROLE_KEY.
// The webhook stays server-side and is never exposed on the public website.
// Deploy with JWT verification disabled.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const safe = (value: unknown) => String(value ?? "").replace(/([\\\\_*~`|>])/g, "\\\\$1").slice(0, 500);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { order_reference } = await req.json();
    if (typeof order_reference !== "string" || !/^DD-[A-Z0-9-]{8,50}$/.test(order_reference)) return json({ error: "A valid order reference is required." }, 400);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
    if (!supabaseUrl || !serviceKey || !webhookUrl) return json({ error: "Discord notification is not fully configured." }, 500);

    const lookup = await fetch(
      `${supabaseUrl}/rest/v1/buylist_orders?order_reference=eq.${encodeURIComponent(order_reference)}&select=order_reference,seller_email,items,estimated_total,created_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!lookup.ok) return json({ error: "Could not verify the saved order." }, 500);
    const order = (await lookup.json())?.[0];
    if (!order) return json({ error: "Order not found." }, 404);

    const items = Array.isArray(order.items) ? order.items : [];
    const itemLines = items.map((item: any) => `• ${safe(item.title)} (${safe(item.platform)}) — ${safe(item.condition_label || item.condition)}, qty ${Number(item.quantity)}`);
    const description = [
      `**Order:** ${safe(order.order_reference)}`,
      `**Submitted:** ${new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central`,
      `**Seller contact:** ${safe(order.seller_email)}`,
      "",
      "**Games in this batch:**",
      ...(itemLines.length ? itemLines : ["No item details found."]),
      "",
      `**Estimated payout:** $${Number(order.estimated_total).toFixed(2)}`,
      "",
      "[Open the buylist admin page](https://dulacdat.github.io/dulacdat-games-buylist/admin.html)",
    ].join("\n").slice(0, 4000);

    const sent = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "DulacDat Games Buylist",
        content: "📦 **New buylist batch submitted — package expected!**",
        embeds: [{ title: "New customer batch", description, color: 3066993 }],
        allowed_mentions: { parse: [] },
      }),
    });
    if (!sent.ok) {
      console.error("Discord webhook error:", sent.status, await sent.text());
      return json({ error: "The order was saved, but the Discord notification could not be sent." }, 502);
    }
    return json({ ok: true, message: "Discord notification sent." });
  } catch (error) {
    console.error(error);
    return json({ error: "Unexpected error sending Discord notification." }, 500);
  }
});
