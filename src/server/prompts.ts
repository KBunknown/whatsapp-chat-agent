import type { CampaignSettings, Contact, Message, ResourceSnippet } from "../shared/types.js";

const commonGivenNames = new Set(
  [
    "abdul",
    "abigail",
    "abraham",
    "adwoa",
    "afrakoma",
    "akwasi",
    "ama",
    "amanor",
    "amponsah",
    "ashley",
    "ashely",
    "benjamin",
    "daniel",
    "david",
    "elizabeth",
    "emmanuel",
    "ernest",
    "fatawu",
    "fiifi",
    "francis",
    "george",
    "isaac",
    "jephthah",
    "john",
    "jonathan",
    "joseph",
    "junior",
    "kofi",
    "kojo",
    "kwabena",
    "kwaku",
    "kweku",
    "kwesi",
    "mame",
    "maxwell",
    "michael",
    "morris",
    "nana",
    "nancy",
    "nicholas",
    "nti",
    "paa",
    "precious",
    "reginald",
    "samuel",
    "stephen",
    "vanessa"
  ].map((name) => name.toLowerCase())
);

function firstName(fullName: string): string {
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "there";
  if (parts.length === 1) return normaliseNamePart(parts[0]);

  const firstToken = cleanNamePart(parts[0]);
  if (commonGivenNames.has(firstToken)) return normaliseNamePart(parts[0]);

  const laterGivenName = parts.slice(1).find((part) => commonGivenNames.has(cleanNamePart(part)));
  if (laterGivenName) return normaliseNamePart(laterGivenName);

  return normaliseNamePart(parts[0]);
}

function cleanNamePart(part: string): string {
  return part.toLowerCase().replace(/[^a-z-]/g, "");
}

function normaliseNamePart(part: string): string {
  if (part === part.toUpperCase()) {
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }
  return part;
}

export function renderTemplate(template: string, contact: Contact, settings: CampaignSettings): string {
  const values: Record<string, string> = {
    candidateName: settings.candidateName,
    fullName: contact.fullName || "there",
    firstName: firstName(contact.fullName),
    programOfStudy: contact.programOfStudy || "your program",
    level: contact.level || "your level",
    institution: contact.institution || "your institution"
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

export function buildInitialMessagePrompt(contact: Contact, settings: CampaignSettings, renderedTemplate: string): string {
  return [
    "You are writing one WhatsApp outreach message for a student election campaign.",
    `Candidate: ${settings.candidateName}.`,
    "",
    "Campaign facts:",
    settings.campaignFacts,
    "",
    "Agent instructions:",
    settings.agentInstructions,
    "",
    "Contact:",
    `Name: ${contact.fullName || "Unknown"}`,
    `Program: ${contact.programOfStudy || "Unknown"}`,
    `Level: ${contact.level || "Unknown"}`,
    `Institution: ${contact.institution || "Unknown"}`,
    "",
    "Base editable template:",
    renderedTemplate,
    "",
    "Rewrite the base template into a warm, natural, concise WhatsApp message.",
    "Do not mention email. Do not include an opt-out line. Do not invent claims beyond the campaign facts.",
    "Return only the message text."
  ].join("\n");
}

export function buildReplyPrompt(
  contact: Contact,
  settings: CampaignSettings,
  summary: string,
  recentMessages: Message[],
  incomingText: string
): string {
  const transcript = recentMessages
    .slice(-12)
    .map((message) => `${message.direction === "inbound" ? "Voter" : "Agent"}: ${message.body}`)
    .join("\n");

  return [
    "You are replying on WhatsApp for a student election campaign.",
    `Candidate: ${settings.candidateName}.`,
    "Goal: respectfully answer the voter and help them feel confident voting for the candidate.",
    "",
    "Campaign facts:",
    settings.campaignFacts,
    "",
    "Agent instructions:",
    settings.agentInstructions,
    "",
    "Contact context:",
    `Name: ${contact.fullName || "Unknown"}`,
    `Program: ${contact.programOfStudy || "Unknown"}`,
    `Level: ${contact.level || "Unknown"}`,
    `Institution: ${contact.institution || "Unknown"}`,
    `Contact record notes: ${contact.importNotes || "None"}`,
    "",
    "Conversation summary:",
    summary || "No prior summary.",
    "",
    "Recent chat:",
    transcript || "No recent messages.",
    "",
    `Latest voter message: ${incomingText}`,
    "",
    "Reply in a warm factual tone. Keep it concise and WhatsApp-friendly.",
    "If the question asks for an unconfirmed detail, say you do not have the confirmed detail yet and offer to follow up.",
    "Never fabricate dates, achievements, endorsements, voting rules, or promises.",
    "Return only the reply text."
  ].join("\n");
}

export function buildReplyDecisionPrompt(
  contact: Contact,
  settings: CampaignSettings,
  summary: string,
  recentMessages: Message[],
  incomingText: string,
  resourceSnippets: ResourceSnippet[] = []
): string {
  const transcript = recentMessages
    .map((message) => {
      const speaker = message.direction === "inbound" ? "Voter" : message.status === "drafted" ? "Agent draft" : "Agent";
      const error = message.error ? ` [error: ${message.error}]` : "";
      return `${speaker} (${message.status}): ${message.body}${error}`;
    })
      .join("\n");
  const resources = resourceSnippets
    .map((snippet) => {
      return `Resource: ${snippet.title} (chunk ${snippet.chunkIndex + 1})\n${snippet.content}`;
    })
    .join("\n\n");

  return [
    "**YOU ARE KWAKU'S TECHNICAL ASSISTANT TO THE FOUNDER**",
    "Not just an automated system — a professional representative building genuine relationships with voters.",
    "",
    `Candidate: ${settings.candidateName}`,
    "",
    "Campaign facts:",
    settings.campaignFacts,
    "",
    "Approved resource snippets:",
    resources || "No approved resource snippet matched this message.",
    "",
    "Agent instructions:",
    settings.agentInstructions,
    "",
    "Contact:",
    `Name: ${contact.fullName || "Unknown"}`,
    `Program: ${contact.programOfStudy || "Unknown"}`,
    `Level: ${contact.level || "Unknown"}`,
    `Institution: ${contact.institution || "Unknown"}`,
    "",
    "Conversation summary:",
    summary || "No prior summary.",
    "",
    "FULL CONVERSATION HISTORY:",
    transcript || "No prior messages.",
    "",
    `INCOMING VOTER MESSAGE: "${incomingText}"`,
    "",
    "YOUR RESPONSIBILITY:",
    "You have the intelligence and context to respond to this voter. The question is: should you handle it, or does Kwaku need to take it personally?",
    "",
    "THINK THROUGH THIS:",
    "1. Do you understand what the voter is asking or concerned about?",
    "2. Can you address it truthfully with the campaign facts and context you have?",
    "3. Can you respond in a way that builds the relationship and shows you remember them?",
    "4. If the answer to all three is YES → You respond. Build on the conversation.",
    "5. If ANY answer is NO → Is it because you're missing context, or is it genuinely beyond your scope?",
    "",
    "WHEN TO ESCALATE (needsHuman=true):",
    "- Legal/regulatory questions you're genuinely unsure about",
    "- Safety-sensitive content",
    "- Direct personal information requests (address, phone number, personal details)",
    "- When voter explicitly asks to speak with Kwaku directly",
    "- When you've done your best to help but the voter needs Kwaku's personal follow-up for trust reasons",
    "",
    "WHEN TO RESPOND (needsHuman=false):",
    "- Questions about platform/initiatives (you know the facts)",
    "- Voter concerns/objections (you can address with platform strengths)",
    "- Requests for information you don't have (offer to check and follow up)",
    "- Voter asking 'when is voting?' (share what you know, ask about their priorities)",
    "- Voter expressing doubt (build confidence by showing you understand their concern)",
    "- Anything where a warm, intelligent, informed response can build the relationship",
    "",
    "SAFE AUTO-SEND RULE:",
    "Set safeToAutoSend=true only when the reply is fully supported by campaign facts or approved resource snippets, does not ask for sensitive personal data, does not share private contact details, does not invent voting logistics, and does not require Kwaku's judgment.",
    "If you are missing confirmed facts, give the best honest draft and set safeToAutoSend=false.",
    "",
    "Return ONLY valid JSON:",
    `{"reply":"your response to the voter","needsHuman":false,"reason":"","outcomeLabel":"replied","safeToAutoSend":true}`,
    "",
    "Allowed outcomeLabel values: replied, supportive, undecided, opposed, opted_out, needs_human.",
    "",
    "EXAMPLES:",
    "",
    "Voter: 'I'm not sure if I should vote for you.'",
    `Reply: (needsHuman=false) "I appreciate you thinking about it. What's your biggest concern right now? Whether it's class timing, lab access, community initiatives, or something else, I'd like to understand what matters most to you."`,
    "",
    "Voter: 'What are you doing about lab access?'",
    `Reply: (needsHuman=false, safeToAutoSend=true) "That is exactly the kind of structured support Kwaku is focusing on. His plan is built around a Review System, Briefing System, and Follow-Up System so the Founder's office works with clarity and accountability."`,
    "",
    "Voter: 'Can I have Kwaku's personal number?'",
    `Reply: (needsHuman=true) This requires Kwaku's direct decision about contact sharing.`,
    "",
    "CORE PRINCIPLE:",
    "You are Kwaku's professional representative — intelligent, trustworthy, knowledgeable about the campaign. Respond from that place. Only escalate when you genuinely need Kwaku's involvement, not as a default safety mechanism."
  ].join("\n");
}

export function buildSummaryPrompt(existingSummary: string, recentMessages: Message[]): string {
  const transcript = recentMessages
    .slice(-20)
    .map((message) => `${message.direction}: ${message.body}`)
    .join("\n");

  return [
    "Update this campaign chat summary in 3 concise bullet-style sentences or fewer.",
    `Existing summary: ${existingSummary || "None"}`,
    "",
    "Recent messages:",
    transcript,
    "",
    "Focus on: voter's stance, platform concerns raised, objections mentioned, sentiment progression, and strategic insights for winning this relationship.",
    "Include what the agent should remember to build rapport and advance voter support in the next reply.",
    "Return only the updated summary."
  ].join("\n");
}
