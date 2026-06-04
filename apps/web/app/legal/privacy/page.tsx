export const metadata = {
  title: "Privacy Policy — MMD Delivery",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-10 prose prose-slate">
      <h1>Privacy Policy</h1>
      <p>
        MMD Delivery collects account information, order and delivery data, location
        during active deliveries, and photos uploaded as proof. Data is stored on
        Supabase and processed by Stripe for payments.
      </p>
      <p>
        For data access or deletion requests, contact{" "}
        <a href="mailto:support@mmddelivery.com">support@mmddelivery.com</a>.
      </p>
    </main>
  );
}
