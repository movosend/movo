ALTER TABLE shipments.shipments
  ADD COLUMN carrier_withdrawal_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN carrier_withdrawal_penalty_ars NUMERIC(12, 2);

CREATE INDEX shipments_carrier_withdrawal_pending_idx
  ON shipments.shipments (id)
  WHERE carrier_withdrawal_pending = TRUE;
