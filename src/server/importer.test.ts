import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.js";
import { importParsedContacts, worksheetRowsToContacts } from "./importer.js";

describe("Excel import", () => {
  it("maps the expected spreadsheet headers", () => {
    const rows = worksheetRowsToContacts([
      [
        "Full Name (Surname first)",
        "WhatsApp Number",
        "Other Number",
        "Active Email Address",
        "Program of study",
        "Level",
        "Institution"
      ],
      ["Wiredu Ama", "0241234567", "", "ama@example.com", "Computer Science", "300", "Test University"]
    ]);

    expect(rows[0]).toMatchObject({
      fullName: "Wiredu Ama",
      whatsappNumber: "0241234567",
      activeEmail: "ama@example.com",
      programOfStudy: "Computer Science"
    });
  });

  it("unwraps read-excel-file default sheet objects safely", () => {
    const rows = worksheetRowsToContacts([
      {
        sheet: "Sheet1",
        data: [
          [
            "Full Name (Surname first)",
            "WhatsApp Number",
            "Other Number",
            "Active Email Address",
            "Program of study",
            "Level",
            "Institution"
          ],
          ["Mensah Kojo", "0551112222", "", "kojo@example.com", "Business", "200", "Test University"]
        ]
      }
    ]);

    expect(rows[0]).toMatchObject({
      fullName: "Mensah Kojo",
      whatsappNumber: "0551112222",
      programOfStudy: "Business"
    });
  });

  it("deduplicates imported contacts by normalized phone", () => {
    const db = openDatabase(":memory:");
    const first = importParsedContacts(db, [
      {
        fullName: "Wiredu Ama",
        whatsappNumber: "0241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Computer Science",
        level: "300",
        institution: "Test University"
      }
    ]);
    const second = importParsedContacts(db, [
      {
        fullName: "Wiredu Ama Updated",
        whatsappNumber: "+233241234567",
        otherNumber: "",
        activeEmail: "",
        programOfStudy: "Engineering",
        level: "400",
        institution: "Test University"
      }
    ]);

    expect(first.created).toBe(1);
    expect(second.updated).toBe(1);
  });
});
