ALTER TABLE businesses ADD COLUMN catalog_revision INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER catalog_products_insert AFTER INSERT ON products
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_products_delete AFTER DELETE ON products
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id);
END;

CREATE TRIGGER catalog_products_update AFTER UPDATE ON products
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id UNION SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_product_details_insert AFTER INSERT ON product_details
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=NEW.product_id);
END;

CREATE TRIGGER catalog_product_details_delete AFTER DELETE ON product_details
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=OLD.product_id);
END;

CREATE TRIGGER catalog_product_details_update AFTER UPDATE ON product_details
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=OLD.product_id UNION SELECT business_id FROM products WHERE id=NEW.product_id);
END;

CREATE TRIGGER catalog_recipes_insert AFTER INSERT ON recipes
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=NEW.product_id);
END;

CREATE TRIGGER catalog_recipes_delete AFTER DELETE ON recipes
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=OLD.product_id);
END;

CREATE TRIGGER catalog_recipes_update AFTER UPDATE ON recipes
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=OLD.product_id UNION SELECT business_id FROM products WHERE id=NEW.product_id);
END;

CREATE TRIGGER catalog_modifier_groups_insert AFTER INSERT ON modifier_groups
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=NEW.product_id);
END;

CREATE TRIGGER catalog_modifier_groups_delete AFTER DELETE ON modifier_groups
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=OLD.product_id);
END;

CREATE TRIGGER catalog_modifier_groups_update AFTER UPDATE ON modifier_groups
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM products WHERE id=OLD.product_id UNION SELECT business_id FROM products WHERE id=NEW.product_id);
END;

CREATE TRIGGER catalog_modifier_options_insert AFTER INSERT ON modifier_options
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT p.business_id FROM products p JOIN modifier_groups g ON g.product_id=p.id WHERE g.id=NEW.group_id);
END;

CREATE TRIGGER catalog_modifier_options_delete AFTER DELETE ON modifier_options
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT p.business_id FROM products p JOIN modifier_groups g ON g.product_id=p.id WHERE g.id=OLD.group_id);
END;

CREATE TRIGGER catalog_modifier_options_update AFTER UPDATE ON modifier_options
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT p.business_id FROM products p JOIN modifier_groups g ON g.product_id=p.id WHERE g.id=OLD.group_id UNION SELECT p.business_id FROM products p JOIN modifier_groups g ON g.product_id=p.id WHERE g.id=NEW.group_id);
END;

CREATE TRIGGER catalog_events_insert AFTER INSERT ON events
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_events_delete AFTER DELETE ON events
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id);
END;

CREATE TRIGGER catalog_events_update AFTER UPDATE ON events
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id UNION SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_event_products_insert AFTER INSERT ON event_products
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM events WHERE id=NEW.event_id);
END;

CREATE TRIGGER catalog_event_products_delete AFTER DELETE ON event_products
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM events WHERE id=OLD.event_id);
END;

CREATE TRIGGER catalog_event_products_update AFTER UPDATE ON event_products
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT business_id FROM events WHERE id=OLD.event_id UNION SELECT business_id FROM events WHERE id=NEW.event_id);
END;

CREATE TRIGGER catalog_business_settings_insert AFTER INSERT ON business_settings
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_business_settings_delete AFTER DELETE ON business_settings
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id);
END;

CREATE TRIGGER catalog_business_settings_update AFTER UPDATE ON business_settings
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id UNION SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_organization_trucks_insert AFTER INSERT ON organization_trucks
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT NEW.business_id);
END;

CREATE TRIGGER catalog_organization_trucks_delete AFTER DELETE ON organization_trucks
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id);
END;

CREATE TRIGGER catalog_organization_trucks_update AFTER UPDATE ON organization_trucks
BEGIN
  UPDATE businesses SET catalog_revision=catalog_revision+1 WHERE id IN (SELECT OLD.business_id UNION SELECT NEW.business_id);
END;
