CREATE INDEX IF NOT EXISTS memberships_business_user_idx ON memberships(business_id,user_id);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON organization_members(user_id,organization_id);
CREATE INDEX IF NOT EXISTS network_availability_user_idx ON network_availability(organization_id,user_id,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS network_transfers_org_idx ON network_transfers(organization_id,status);
CREATE INDEX IF NOT EXISTS network_trucks_org_active_idx ON organization_trucks(organization_id,business_id) WHERE NOT archived;

CREATE TRIGGER network_owner_delete BEFORE DELETE ON organization_members
WHEN OLD.role = 'network_owner' AND NOT EXISTS (
  SELECT 1 FROM organization_members WHERE organization_id = OLD.organization_id
  AND role = 'network_owner' AND user_id <> OLD.user_id
) BEGIN
  SELECT RAISE(ABORT, 'Organization must retain a network owner');
END;
CREATE TRIGGER network_owner_update BEFORE UPDATE ON organization_members
WHEN (OLD.role = 'network_owner' AND NOT EXISTS (
  SELECT 1 FROM organization_members WHERE organization_id = OLD.organization_id
  AND role = 'network_owner' AND user_id <> OLD.user_id
)) AND (NEW.role <> 'network_owner' OR NEW.organization_id <> OLD.organization_id) BEGIN
  SELECT RAISE(ABORT, 'Organization must retain a network owner');
END;
