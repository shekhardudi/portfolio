"""
Pydantic models for request/response validation and data representation.
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


class CompanySizeEnum(str, Enum):
    """Company size categories"""
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    ENTERPRISE = "enterprise"


class SortByEnum(str, Enum):
    """Sort options"""
    RELEVANCE = "relevance"
    NAME = "name"
    EMPLOYEES = "employees"
    YEAR = "year"
    SIZE = "size"


# ============================================================================
# Company Models
# ============================================================================

class Company(BaseModel):
    """Core company data model"""
    id: str
    name: str
    domain: str
    year_founded: Optional[int] = None
    industry: str
    size_range: str
    country: str
    locality: str
    linkedin_url: Optional[str] = None
    current_employee_estimate: Optional[int] = None
    total_employee_estimate: Optional[int] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "id": "5872184",
                "name": "IBM",
                "domain": "ibm.com",
                "year_founded": 1911,
                "industry": "Information Technology and Services",
                "size_range": "10001+",
                "country": "United States",
                "locality": "New York, New York",
                "linkedin_url": "linkedin.com/company/ibm",
                "current_employee_estimate": 274047
            }
        }


class CompanySearchResult(BaseModel):
    """Company with relevance metadata"""
    company: Company
    relevance_score: float = Field(ge=0, le=1)
    matching_reason: Optional[str] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "company": {
                    "id": "5872184",
                    "name": "IBM"
                },
                "relevance_score": 0.95,
                "matching_reason": "Matched on technology industry and US location"
            }
        }


class FacetValue(BaseModel):
    """Facet count for filtering"""
    name: str
    count: int


class SearchFacets(BaseModel):
    """Aggregated facets for drill-down filtering"""
    industries: List[FacetValue] = []
    countries: List[FacetValue] = []
    size_ranges: List[FacetValue] = []
    year_ranges: List[FacetValue] = []


# ============================================================================
# Request Models
# ============================================================================

class BasicSearchRequest(BaseModel):
    """Basic company search request"""
    q: Optional[str] = Field(None, description="Free text search query")
    industry: Optional[List[str]] = Field(None, description="Filter by industries")
    country: Optional[str] = Field(None, description="Filter by country")
    locality: Optional[str] = Field(None, description="Filter by city/locality")
    year_from: Optional[int] = Field(None, ge=1800, le=2100)
    year_to: Optional[int] = Field(None, ge=1800, le=2100)
    size: Optional[List[str]] = Field(None, description="Company size [small, medium, large, enterprise]")
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)
    sort: SortByEnum = SortByEnum.RELEVANCE
    
    class Config:
        json_schema_extra = {
            "example": {
                "q": "tech companies",
                "industry": ["Information Technology"],
                "country": "United States",
                "year_from": 2000,
                "page": 1,
                "limit": 20
            }
        }


class IntelligentSearchRequest(BaseModel):
    """Intelligent/AI-powered search request"""
    query: str = Field(..., description="Natural language query")
    llm_enhanced: bool = Field(True, description="Use LLM for query understanding")
    semantic_search: bool = Field(True, description="Use semantic/vector search")
    enable_filters: bool = Field(True, description="Extract and apply filters from query")
    max_results: int = Field(50, ge=1, le=200)
    confidence_threshold: float = Field(0.5, ge=0, le=1)
    
    class Config:
        json_schema_extra = {
            "example": {
                "query": "tech companies in california founded in the last 5 years",
                "llm_enhanced": True,
                "semantic_search": True
            }
        }


class SemanticSearchRequest(BaseModel):
    """Semantic/vector-based search"""
    query: str = Field(..., description="Query to embed and search")
    top_k: int = Field(20, ge=1, le=200)
    similarity_threshold: float = Field(0.7, ge=0, le=1)
    filters: Optional[Dict[str, Any]] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "query": "software companies similar to Microsoft",
                "top_k": 20
            }
        }


class AgenticSearchRequest(BaseModel):
    """Agentic search with multi-step reasoning"""
    query: str = Field(..., description="Complex query requiring reasoning")
    max_steps: int = Field(5, ge=1, le=10)
    enable_external_api: bool = Field(False, description="Enable external data sources")
    reasoning_type: str = Field("general", description="Type of reasoning: general, funding, news")
    
    class Config:
        json_schema_extra = {
            "example": {
                "query": "Find companies that announced funding in the last 2 months and operate in fintech",
                "max_steps": 5
            }
        }


# ============================================================================
# Response Models
# ============================================================================

class QueryUnderstanding(BaseModel):
    """LLM-extracted query understanding"""
    intent: str = Field(..., description="Query intent classification")
    entities: Dict[str, Any] = Field(..., description="Extracted entities")
    confidence: float = Field(..., ge=0, le=1)


class BasicSearchResponse(BaseModel):
    """Response for basic search"""
    total: int
    page: int
    limit: int
    results: List[CompanySearchResult]
    facets: SearchFacets
    search_time_ms: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "total": 1247,
                "page": 1,
                "limit": 20,
                "results": [],
                "facets": {"industries": []},
                "search_time_ms": 245
            }
        }


class IntelligentSearchResponse(BaseModel):
    """Response for intelligent search"""
    query_understanding: QueryUnderstanding
    results: List[CompanySearchResult]
    search_time_ms: int
    query_classified: bool
    facets: Optional[SearchFacets] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "query_understanding": {
                    "intent": "filtered_company_search",
                    "entities": {"industries": ["technology"]},
                    "confidence": 0.92
                },
                "results": []
            }
        }


class ReasoningStep(BaseModel):
    """Single step in agentic reasoning"""
    step: int
    action: str
    description: str
    result: Any
    source: Optional[str] = None


class AgenticSearchResponse(BaseModel):
    """Response for agentic search"""
    reasoning_steps: List[ReasoningStep]
    results: List[CompanySearchResult]
    total_steps: int
    search_time_ms: int
    
    class Config:
        json_schema_extra = {
            "example": {
                "reasoning_steps": [
                    {
                        "step": 1,
                        "action": "search_opensearch",
                        "description": "Initial company search",
                        "result": "Found 500 matches"
                    }
                ],
                "results": []
            }
        }


# ============================================================================
# Tag Models
# ============================================================================

class Tag(BaseModel):
    """User-created tag"""
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    company_count: int = 0


class TagCreateRequest(BaseModel):
    """Request to create a tag"""
    tag_name: str
    description: Optional[str] = None
    companies: List[str] = Field(default_factory=list, description="Company IDs to tag")


class TagUpdateRequest(BaseModel):
    """Request to update a tag"""
    description: Optional[str] = None
    add_companies: Optional[List[str]] = None
    remove_companies: Optional[List[str]] = None


class TagResponse(BaseModel):
    """Tag operation response"""
    tag_id: str
    tag_name: str
    created_at: datetime
    companies_tagged: int
    status: str


# ============================================================================
# Health & Status Models
# ============================================================================

class ServiceHealth(BaseModel):
    """Health status of a service"""
    service: str
    status: str  # "healthy", "degraded", "down"
    response_time_ms: Optional[int] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """Overall system health"""
    status: str
    services: Dict[str, ServiceHealth]
    timestamp: datetime
