import pytest
from app.schemas import (
    InvestmentPlan, InvestmentPlanResponse,
    ETFPlan, ETFPlanResponse,
    DeFiPlan, DeFiPlanResponse,
    OptionsPlan, OptionsPlanResponse
)
from datetime import datetime


NOW = datetime.utcnow()


class TestInvestmentPlanTags:
    """Tests for InvestmentPlan tags field"""

    def test_investment_plan_accepts_tags(self):
        plan = InvestmentPlan(
            id="test-id",
            name="Test Plan",
            description="Test Description",
            minimum_investment=100,
            holding_period_months=6,
            expected_return_percent=10.0,
            tags=["hot", "recommended"],
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == ["hot", "recommended"]

    def test_investment_plan_defaults_empty_tags(self):
        plan = InvestmentPlan(
            id="test-id",
            name="Test Plan",
            description="Test Description",
            minimum_investment=100,
            holding_period_months=6,
            expected_return_percent=10.0,
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == []

    def test_investment_plan_rejects_invalid_tag(self):
        with pytest.raises(ValueError) as exc_info:
            InvestmentPlan(
                id="test-id",
                name="Test Plan",
                description="Test Description",
                minimum_investment=100,
                holding_period_months=6,
                expected_return_percent=10.0,
                tags=["invalid_tag"],
                created_at=NOW,
                updated_at=NOW
            )
        assert "Invalid tag" in str(exc_info.value)

    def test_investment_plan_accepts_all_valid_tags(self):
        plan = InvestmentPlan(
            id="test-id",
            name="Test Plan",
            description="Test Description",
            minimum_investment=100,
            holding_period_months=6,
            expected_return_percent=10.0,
            tags=["hot", "recommended", "new", "popular", "featured", "trending"],
            created_at=NOW,
            updated_at=NOW
        )
        assert set(plan.tags) == {"hot", "recommended", "new", "popular", "featured", "trending"}

    def test_investment_plan_response_includes_tags(self):
        response = InvestmentPlanResponse(
            id="test-id",
            name="Test Plan",
            description="Test Description",
            minimum_investment=100,
            holding_period_months=6,
            expected_return_percent=10.0,
            current_subscribers=50,
            is_active=True
        )
        assert hasattr(response, 'tags')
        assert response.tags == []


class TestETFPlanTags:
    """Tests for ETFPlan tags field"""

    def test_etf_plan_accepts_tags(self):
        plan = ETFPlan(
            id="test-id",
            name="Test ETF Plan",
            plan_type="Conservative",
            expected_return_percent=8.0,
            duration_months=12,
            minimum_investment=500,
            tags=["hot", "new"],
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == ["hot", "new"]

    def test_etf_plan_defaults_empty_tags(self):
        plan = ETFPlan(
            id="test-id",
            name="Test ETF Plan",
            plan_type="Conservative",
            expected_return_percent=8.0,
            duration_months=12,
            minimum_investment=500,
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == []

    def test_etf_plan_rejects_invalid_tag(self):
        with pytest.raises(ValueError) as exc_info:
            ETFPlan(
                id="test-id",
                name="Test ETF Plan",
                plan_type="Conservative",
                expected_return_percent=8.0,
                duration_months=12,
                minimum_investment=500,
                tags=["invalid_tag"],
                created_at=NOW,
                updated_at=NOW
            )
        assert "Invalid tag" in str(exc_info.value)


class TestDeFiPlanTags:
    """Tests for DeFiPlan tags field"""

    def test_defi_plan_accepts_tags(self):
        plan = DeFiPlan(
            id="test-id",
            name="Test DeFi Plan",
            portfolio_type="Moderate",
            expected_return_percent=12.0,
            duration_months=6,
            minimum_investment=1000,
            tags=["recommended", "featured"],
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == ["recommended", "featured"]

    def test_defi_plan_defaults_empty_tags(self):
        plan = DeFiPlan(
            id="test-id",
            name="Test DeFi Plan",
            portfolio_type="Moderate",
            expected_return_percent=12.0,
            duration_months=6,
            minimum_investment=1000,
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == []

    def test_defi_plan_rejects_invalid_tag(self):
        with pytest.raises(ValueError) as exc_info:
            DeFiPlan(
                id="test-id",
                name="Test DeFi Plan",
                portfolio_type="Moderate",
                expected_return_percent=12.0,
                duration_months=6,
                minimum_investment=1000,
                tags=["invalid_tag"],
                created_at=NOW,
                updated_at=NOW
            )
        assert "Invalid tag" in str(exc_info.value)


class TestOptionsPlanTags:
    """Tests for OptionsPlan tags field"""

    def test_options_plan_accepts_tags(self):
        plan = OptionsPlan(
            id="test-id",
            name="Test Options Plan",
            plan_type="Beginner",
            expected_return_percent=15.0,
            duration_months=3,
            minimum_investment=2000,
            tags=["popular", "trending"],
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == ["popular", "trending"]

    def test_options_plan_defaults_empty_tags(self):
        plan = OptionsPlan(
            id="test-id",
            name="Test Options Plan",
            plan_type="Beginner",
            expected_return_percent=15.0,
            duration_months=3,
            minimum_investment=2000,
            created_at=NOW,
            updated_at=NOW
        )
        assert plan.tags == []

    def test_options_plan_rejects_invalid_tag(self):
        with pytest.raises(ValueError) as exc_info:
            OptionsPlan(
                id="test-id",
                name="Test Options Plan",
                plan_type="Beginner",
                expected_return_percent=15.0,
                duration_months=3,
                minimum_investment=2000,
                tags=["invalid_tag"],
                created_at=NOW,
                updated_at=NOW
            )
        assert "Invalid tag" in str(exc_info.value)