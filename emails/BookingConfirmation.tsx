import {
  Body,
  Container,
  Column,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Text,
  Hr,
  Link,
} from "@react-email/components";

type Props = {
  guestName: string;
  bookingCode: string;
  resourceName: string; // "Court 4" or "Wash Bay 2"
  dateLabel: string; // "Fri, Sep 5"
  timeLabel: string; // "18:00 – 19:00"
  priceLabel: string; // "$40.00"
  paymentStatus: "paid" | "unpaid";
  qrDataUrl: string; // base64 PNG data URL
  clubName: string;
  clubAddress: string;
  siteUrl: string;
};

export default function BookingConfirmation({
  guestName = "Alex",
  bookingCode = "A1B2C3D4",
  resourceName = "Court 4",
  dateLabel = "Fri, Sep 5",
  timeLabel = "18:00 – 19:00",
  priceLabel = "$40.00",
  paymentStatus = "paid",
  qrDataUrl = "",
  clubName = "Nexus Padel Club",
  clubAddress = "12 Court Lane, Tbilisi",
  siteUrl = "https://example.com",
}: Props) {
  return (
    <Html>
      <Head />
      <Preview>
        Your {resourceName} booking is confirmed — {dateLabel}, {timeLabel}
      </Preview>
      <Body style={body}>
        <Container style={container}>
          <Section style={{ textAlign: "center", paddingBottom: 24 }}>
            <Text style={brand}>{clubName.toUpperCase()}</Text>
          </Section>

          <Section style={card}>
            <Text style={eyebrow}>Booking confirmed</Text>
            <Heading style={h1}>{resourceName}</Heading>
            <Text style={sub}>
              {dateLabel} · {timeLabel}
            </Text>

            <Hr style={hr} />

            <Row>
              <Column>
                <Text style={label}>Booking code</Text>
                <Text style={value}>{bookingCode}</Text>
              </Column>
              <Column>
                <Text style={label}>Amount</Text>
                <Text style={value}>{priceLabel}</Text>
              </Column>
              <Column>
                <Text style={label}>Payment</Text>
                <Text style={{ ...value, color: paymentStatus === "paid" ? "#00BFA5" : "#F59E0B" }}>
                  {paymentStatus === "paid" ? "Paid" : "Pending"}
                </Text>
              </Column>
            </Row>

            {qrDataUrl && (
              <Section style={{ textAlign: "center", padding: "20px 0" }}>
                <Img src={qrDataUrl} width="140" height="140" alt="Booking QR code" style={qrImg} />
                <Text style={{ ...label, textAlign: "center" }}>
                  Show this at check-in
                </Text>
              </Section>
            )}
          </Section>

          <Section style={{ padding: "24px 4px" }}>
            <Text style={sectionTitle}>Location & directions</Text>
            <Text style={bodyText}>{clubAddress}</Text>
            <Link href={`${siteUrl}/directions`} style={link}>
              Get directions →
            </Link>

            <Text style={{ ...sectionTitle, marginTop: 24 }}>Club rules</Text>
            <Text style={bodyText}>
              Please arrive 10 minutes before your slot. Non-marking shoes are required on
              all courts. Cancellations within 4 hours of the slot are non-refundable.
            </Text>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            Hi {guestName}, thanks for booking with {clubName}. Need to make changes?{" "}
            <Link href={`${siteUrl}/bookings/${bookingCode}`} style={link}>
              Manage your booking
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#F5F7FA",
  fontFamily: "'Inter', Helvetica, Arial, sans-serif",
  padding: "32px 0",
};
const container: React.CSSProperties = { maxWidth: 480, margin: "0 auto", padding: "0 16px" };
const brand: React.CSSProperties = {
  color: "#001A33",
  fontSize: 13,
  letterSpacing: 2,
  fontWeight: 800,
};
const card: React.CSSProperties = {
  backgroundColor: "#FFFFFF",
  border: "1px solid #E2E8F0",
  borderRadius: 14,
  padding: "28px 24px",
  boxShadow: "0 1px 3px rgba(0,26,51,0.06)",
};
const eyebrow: React.CSSProperties = {
  color: "#0066CC",
  fontSize: 12,
  fontWeight: 700,
  margin: 0,
};
const h1: React.CSSProperties = {
  color: "#001A33",
  fontSize: 28,
  fontWeight: 800,
  margin: "6px 0 2px",
};
const sub: React.CSSProperties = { color: "#4A5568", fontSize: 14, margin: 0 };
const hr: React.CSSProperties = { borderColor: "#E2E8F0", margin: "20px 0" };
const label: React.CSSProperties = {
  color: "#4A5568",
  fontSize: 11,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  margin: "0 0 4px",
};
const value: React.CSSProperties = { color: "#001A33", fontSize: 15, fontWeight: 700, margin: 0 };
const sectionTitle: React.CSSProperties = {
  color: "#001A33",
  fontSize: 14,
  fontWeight: 700,
  margin: "0 0 6px",
};
const bodyText: React.CSSProperties = { color: "#4A5568", fontSize: 13, lineHeight: 1.6, margin: 0 };
const link: React.CSSProperties = { color: "#0066CC", fontSize: 13, fontWeight: 600 };
const footer: React.CSSProperties = { color: "#4A5568", fontSize: 12, lineHeight: 1.6, textAlign: "center" };
const qrImg: React.CSSProperties = {
  border: "1px solid #E2E8F0",
  borderRadius: 8,
  padding: 8,
};
