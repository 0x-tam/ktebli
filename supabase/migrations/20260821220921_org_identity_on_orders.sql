alter table pre_intakes add column if not exists org_website text;
alter table orders add column if not exists org_reg text;
alter table orders add column if not exists org_website text;