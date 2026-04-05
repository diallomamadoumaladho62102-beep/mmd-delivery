export default function VendorPage({ params }: { params: { vendorId: string }}) {
  return <main>Vendor: {params.vendorId}</main>;
}

