CREATE INDEX IF NOT EXISTS memberships_business_user_idx ON memberships(business_id,user_id);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id,organization_id);
CREATE INDEX IF NOT EXISTS network_availability_user_idx ON network_availability(organization_id,user_id,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS network_transfers_org_idx ON network_transfers(organization_id,status);
CREATE INDEX IF NOT EXISTS network_trucks_org_active_idx ON organization_trucks(organization_id,business_id) WHERE NOT archived;
CREATE OR REPLACE FUNCTION protect_network_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'network_owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'network_owner' OR NEW.organization_id <> OLD.organization_id) THEN
    PERFORM pg_advisory_xact_lock(hashtext('network-owner'),hashtext(OLD.organization_id));
    IF NOT EXISTS (SELECT 1 FROM organization_members WHERE organization_id=OLD.organization_id AND role='network_owner' AND user_id<>OLD.user_id) THEN
      RAISE EXCEPTION 'Organization must retain a network owner' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER network_owner_guard BEFORE DELETE OR UPDATE ON organization_members FOR EACH ROW EXECUTE FUNCTION protect_network_owner();
