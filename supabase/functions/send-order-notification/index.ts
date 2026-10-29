// Sends a notification to the business inbox for a saved buylist order.
// Required Supabase secrets: RESEND_API_KEY and SUPABASE_SERVICE_ROLE_KEY.
// Deploy with JWT verification disabled; this function validates the order reference
// against the database and only ever sends to the fixed business inbox.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { order_reference } = await req.json();
    if (typeof order_reference !== "string" || !/^DD-[A-Z0-9-]{8,50}$/.test(order_reference)) {
      return json({ error: "A valid order reference is required." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!supabaseUrl || !serviceKey || !resendKey) {
      return json({ error: "Email service is not fully configured." }, 500);
    }

    const lookup = await fetch(
      `${supabaseUrl}/rest/v1/buylist_orders?order_reference=eq.${encodeURIComponent(order_reference)}&select=order_reference,seller_email,paypal_email,items,estimated_total,created_at`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (!lookup.ok) return json({ error: "Could not verify the saved order." }, 500);
    const rows = await lookup.json();
    const order = rows?.[0];
    if (!order) return json({ error: "Order not found." }, 404);

    const items = Array.isArray(order.items) ? order.items : [];
    const itemLines = items.map((item: any) =>
      `• ${item.title} (${item.platform}) — ${item.condition_label || item.condition}, qty ${item.quantity}, ${Number(item.line_total).toFixed(2)}`
    );
    const textBody = [
      "A new DulacDat Games Buylist order was submitted.",
      "",
      `Order: ${order.order_reference}`,
      `Submitted: ${new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central`,
      `Contact email: ${order.seller_email}`,
      `PayPal email: ${order.paypal_email}`,
      "",
      "ITEMS",
      ...itemLines,
      "",
      `Estimated total: $${Number(order.estimated_total).toFixed(2)}`,
      "",
      "View and manage this order in the private admin page:",
      "https://dulacdat.github.io/dulacdat-games-buylist/admin.html",
    ].join("\n");

    const htmlItems = items.map((item: any) =>
      `<li>${escapeHtml(item.title)} (${escapeHtml(item.platform)}) — ${escapeHtml(item.condition_label || item.condition)}, qty ${Number(item.quantity)}, $${Number(item.line_total).toFixed(2)}</li>`
    ).join("");
    const htmlBody = `<h2>New DulacDat Games Buylist order</h2>
      <p><b>Order:</b> ${escapeHtml(order.order_reference)}<br>
      <b>Submitted:</b> ${escapeHtml(new Date(order.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" }))} Central<br>
      <b>Contact email:</b> ${escapeHtml(order.seller_email)}<br>
      <b>PayPal email:</b> ${escapeHtml(order.paypal_email)}</p>
      <h3>Items</h3><ul>${htmlItems}</ul>
      <p><b>Estimated total: $${Number(order.estimated_total).toFixed(2)}</b></p>
      <p><a href="https://dulacdat.github.io/dulacdat-games-buylist/admin.html">Open the private admin page</a></p>`;

    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "DulacDat Buylist <onboarding@resend.dev>",
        to: ["dulacdatbusiness@gmail.com"],
        subject: `New buylist order ${order.order_reference}`,
        text: textBody,
        html: htmlBody,
      }),
    });
    if (!sent.ok) {
      const detail = await sent.text();
      console.error("Resend error:", detail);
      return json({ error: "The order was saved, but the notification email could not be sent." }, 502);
    }

    return json({ ok: true, message: "Notification email sent." });
  } catch (error) {
    console.error(error);
    return json({ error: "Unexpected error sending notification." }, 500);
  }
});
