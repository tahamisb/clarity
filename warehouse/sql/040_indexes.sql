-- Indexes chosen from the queries the dashboards actually run
-- (backend/app/services/db_*.py and cancellation_service.py): a time filter
-- plus a group-by on merchant / zone / status / hour, over and over.

SET search_path = warehouse, public;

-- Orders. Nearly every cancellation query filters on the placement date and
-- groups by one dimension, so lead with the date.
CREATE INDEX vendor_kpi_placement_date_idx  ON vendor_kpi (order_placement_date);
CREATE INDEX vendor_kpi_placed_at_idx       ON vendor_kpi (placed_at DESC);
CREATE INDEX vendor_kpi_status_date_idx     ON vendor_kpi (order_status, order_placement_date);
CREATE INDEX vendor_kpi_zone_date_idx       ON vendor_kpi (zone_name, order_placement_date);
CREATE INDEX vendor_kpi_merchant_date_idx   ON vendor_kpi (restaurant_name, order_placement_date);
CREATE INDEX vendor_kpi_platform_date_idx   ON vendor_kpi (platform_name, order_placement_date);

-- The live risk queue: non-terminal orders, newest first. A partial index
-- keeps it tiny however large the history grows.
CREATE INDEX vendor_kpi_open_orders_idx ON vendor_kpi (placed_at DESC)
    WHERE order_status IN ('Accepted', 'Preparing', 'Ready for pickup', 'Out for delivery');

CREATE INDEX vendor_items_order_idx ON vendor_items_kpi (order_id);

-- Support messages: time-series, SLA (open conversations) and the joins to
-- classifications.
CREATE INDEX messages_created_idx  ON messages (created_at);
CREATE INDEX messages_channel_idx  ON messages (source_channel, created_at);
CREATE INDEX messages_zone_idx     ON messages (zone, created_at);
CREATE INDEX messages_merchant_idx ON messages (merchant_name, created_at);
CREATE INDEX messages_open_idx     ON messages (created_at) WHERE closed_at IS NULL;

CREATE INDEX classifications_message_idx   ON classifications (message_id);
CREATE INDEX classifications_at_idx        ON classifications (classified_at);
CREATE INDEX classifications_sentiment_idx ON classifications (sentiment, classified_at);
-- Top-negative-triggers scans this constantly and only cares about negatives.
CREATE INDEX classifications_trigger_idx   ON classifications (negative_trigger)
    WHERE negative_trigger IS NOT NULL;

CREATE INDEX chat_history_created_idx ON chat_history (created_at);
CREATE INDEX chat_history_order_idx   ON chat_history (order_id);

CREATE INDEX call_analysis_analysed_idx ON call_analysis (analysed_at);
CREATE INDEX call_analysis_intent_idx   ON call_analysis (primary_intent, analysed_at);

CREATE INDEX cancellation_predictions_order_idx ON cancellation_predictions (order_id);
CREATE INDEX cancellation_predictions_queue_idx ON cancellation_predictions (predicted_at DESC, risk_level);
