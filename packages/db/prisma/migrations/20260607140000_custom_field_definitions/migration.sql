-- Custom Field Definitions (additive — does NOT modify contacts.custom Json column)
CREATE TABLE custom_field_definitions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    business_id TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    description TEXT,
    placeholder TEXT,
    options JSONB,
    default_value JSONB,
    required BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    archived_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT custom_field_definitions_business_id_name UNIQUE (business_id, name)
);

CREATE INDEX idx_custom_field_definitions_business_id ON custom_field_definitions(business_id);
CREATE INDEX idx_custom_field_definitions_business_archived ON custom_field_definitions(business_id, archived_at);

-- Contact Custom Field Values
CREATE TABLE contact_custom_field_values (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    contact_id TEXT NOT NULL,
    definition_id TEXT NOT NULL,
    value JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT contact_custom_field_values_contact_definition UNIQUE (contact_id, definition_id)
);

CREATE INDEX idx_contact_custom_field_values_contact_id ON contact_custom_field_values(contact_id);
CREATE INDEX idx_contact_custom_field_values_definition_id ON contact_custom_field_values(definition_id);

-- Foreign keys
ALTER TABLE contact_custom_field_values
    ADD CONSTRAINT fk_contact_custom_field_values_contact
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

ALTER TABLE contact_custom_field_values
    ADD CONSTRAINT fk_contact_custom_field_values_definition
    FOREIGN KEY (definition_id) REFERENCES custom_field_definitions(id) ON DELETE CASCADE;
