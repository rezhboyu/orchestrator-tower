//! 資料庫模型定義
//!
//! 定義 ReasoningNode、HitlRecord、AgentRecord 結構體

use rusqlite::Row;
use serde::{Deserialize, Serialize};

/// 節點類型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Thought,
    ToolCall,
    ToolResult,
    Decision,
    Error,
}

impl NodeType {
    pub fn as_str(&self) -> &'static str {
        match self {
            NodeType::Thought => "thought",
            NodeType::ToolCall => "tool_call",
            NodeType::ToolResult => "tool_result",
            NodeType::Decision => "decision",
            NodeType::Error => "error",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "thought" => Some(NodeType::Thought),
            "tool_call" => Some(NodeType::ToolCall),
            "tool_result" => Some(NodeType::ToolResult),
            "decision" => Some(NodeType::Decision),
            "error" => Some(NodeType::Error),
            _ => None,
        }
    }
}

/// 節點狀態
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeStatus {
    Pending,
    Active,
    Completed,
    Failed,
    Frozen,
}

impl NodeStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            NodeStatus::Pending => "pending",
            NodeStatus::Active => "active",
            NodeStatus::Completed => "completed",
            NodeStatus::Failed => "failed",
            NodeStatus::Frozen => "frozen",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(NodeStatus::Pending),
            "active" => Some(NodeStatus::Active),
            "completed" => Some(NodeStatus::Completed),
            "failed" => Some(NodeStatus::Failed),
            "frozen" => Some(NodeStatus::Frozen),
            _ => None,
        }
    }
}

/// 推理節點
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReasoningNode {
    pub id: String,
    pub agent_id: String,
    pub project_id: String,
    pub parent_id: Option<String>,
    pub node_type: NodeType,
    pub content: String, // JSON
    pub status: NodeStatus,
    pub git_snapshot_sha: Option<String>,
    pub created_at: i64, // Unix timestamp
    pub updated_at: i64, // Unix timestamp
}

impl ReasoningNode {
    /// 從資料庫列建立 ReasoningNode
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let node_type_str: String = row.get(4)?;
        let status_str: String = row.get(6)?;

        Ok(Self {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            project_id: row.get(2)?,
            parent_id: row.get(3)?,
            node_type: NodeType::from_str(&node_type_str).unwrap_or(NodeType::Thought),
            content: row.get(5)?,
            status: NodeStatus::from_str(&status_str).unwrap_or(NodeStatus::Pending),
            git_snapshot_sha: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }
}

/// 風險等級
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    Critical,
    High,
    Medium,
    Low,
}

impl RiskLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Critical => "critical",
            RiskLevel::High => "high",
            RiskLevel::Medium => "medium",
            RiskLevel::Low => "low",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "critical" => Some(RiskLevel::Critical),
            "high" => Some(RiskLevel::High),
            "medium" => Some(RiskLevel::Medium),
            "low" => Some(RiskLevel::Low),
            _ => None,
        }
    }
}

/// 決策者類型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DecidedBy {
    Human,
    OrchestratorBMode,
}

impl DecidedBy {
    pub fn as_str(&self) -> &'static str {
        match self {
            DecidedBy::Human => "human",
            DecidedBy::OrchestratorBMode => "orchestrator_b_mode",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "human" => Some(DecidedBy::Human),
            "orchestrator_b_mode" => Some(DecidedBy::OrchestratorBMode),
            _ => None,
        }
    }
}

/// HITL 記錄（審計日誌）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HitlRecord {
    pub id: String,
    pub agent_id: String,
    pub tool_name: String,
    pub input: String,          // JSON
    pub risk_level: RiskLevel,
    pub approved: bool,
    pub modified_input: Option<String>, // JSON
    pub reason: Option<String>,
    pub decided_by: DecidedBy,
    pub created_at: i64, // Unix timestamp
}

impl HitlRecord {
    /// 從資料庫列建立 HitlRecord
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let risk_level_str: String = row.get(4)?;
        let approved_int: i32 = row.get(5)?;
        let decided_by_str: String = row.get(8)?;

        Ok(Self {
            id: row.get(0)?,
            agent_id: row.get(1)?,
            tool_name: row.get(2)?,
            input: row.get(3)?,
            risk_level: RiskLevel::from_str(&risk_level_str).unwrap_or(RiskLevel::Medium),
            approved: approved_int != 0,
            modified_input: row.get(6)?,
            reason: row.get(7)?,
            decided_by: DecidedBy::from_str(&decided_by_str).unwrap_or(DecidedBy::Human),
            created_at: row.get(9)?,
        })
    }
}

/// Agent 記錄（生命週期追蹤）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRecord {
    pub id: String,
    pub project_id: String,
    pub model: String,
    pub priority: i32,
    pub created_at: i64,         // Unix timestamp
    pub deleted_at: Option<i64>, // Unix timestamp, null 表示仍活躍
}

impl AgentRecord {
    /// 從資料庫列建立 AgentRecord
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            project_id: row.get(1)?,
            model: row.get(2)?,
            priority: row.get(3)?,
            created_at: row.get(4)?,
            deleted_at: row.get(5)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_type_round_trip() {
        for nt in [
            NodeType::Thought,
            NodeType::ToolCall,
            NodeType::ToolResult,
            NodeType::Decision,
            NodeType::Error,
        ] {
            assert_eq!(NodeType::from_str(nt.as_str()), Some(nt));
        }
    }

    #[test]
    fn node_status_round_trip() {
        for ns in [
            NodeStatus::Pending,
            NodeStatus::Active,
            NodeStatus::Completed,
            NodeStatus::Failed,
            NodeStatus::Frozen,
        ] {
            assert_eq!(NodeStatus::from_str(ns.as_str()), Some(ns));
        }
    }

    #[test]
    fn risk_level_round_trip() {
        for rl in [
            RiskLevel::Critical,
            RiskLevel::High,
            RiskLevel::Medium,
            RiskLevel::Low,
        ] {
            assert_eq!(RiskLevel::from_str(rl.as_str()), Some(rl));
        }
    }

    #[test]
    fn decided_by_round_trip() {
        for db in [DecidedBy::Human, DecidedBy::OrchestratorBMode] {
            assert_eq!(DecidedBy::from_str(db.as_str()), Some(db));
        }
    }
}
