export interface NormalizedPhone {
  selectedPhone: string;
  normalizedPhone: string;
  phoneSource: "whatsapp" | "other" | "none";
  notes: string[];
}

export function normalizeGhanaPhone(raw: string): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/[^\d+]/g, "");

  if (!cleaned) return "";

  if (cleaned.startsWith("+")) {
    return `+${cleaned.slice(1).replace(/\D/g, "")}`;
  }

  if (cleaned.startsWith("00")) {
    return `+${cleaned.slice(2)}`;
  }

  if (cleaned.startsWith("233")) {
    return `+${cleaned}`;
  }

  if (cleaned.startsWith("0")) {
    return `+233${cleaned.slice(1)}`;
  }

  if (cleaned.length === 9) {
    return `+233${cleaned}`;
  }

  return `+${cleaned}`;
}

export function chooseAndNormalizePhone(whatsappNumber: string, otherNumber: string): NormalizedPhone {
  const notes: string[] = [];
  const primary = String(whatsappNumber || "").trim();
  const secondary = String(otherNumber || "").trim();

  if (primary) {
    return {
      selectedPhone: primary,
      normalizedPhone: normalizeGhanaPhone(primary),
      phoneSource: "whatsapp",
      notes
    };
  }

  if (secondary) {
    notes.push("Primary WhatsApp number missing; using Other Number for review.");
    return {
      selectedPhone: secondary,
      normalizedPhone: normalizeGhanaPhone(secondary),
      phoneSource: "other",
      notes
    };
  }

  notes.push("No usable phone number found.");
  return {
    selectedPhone: "",
    normalizedPhone: "",
    phoneSource: "none",
    notes
  };
}

export function phoneToWhatsAppId(phone: string): string {
  return normalizeGhanaPhone(phone).replace(/^\+/, "");
}
