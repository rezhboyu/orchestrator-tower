import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import type { RiskLevel } from '../../types/events';

interface HitlRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
  riskLevel: RiskLevel;
}

interface HitlReviewProps {
  agentId: string;
  hitlRequest: HitlRequest;
  onComplete: () => void;
}

const RISK_LEVEL_STYLES: Record<RiskLevel, string> = {
  critical: 'bg-red-600 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-green-600 text-white',
};

const RISK_LEVEL_BORDER: Record<RiskLevel, string> = {
  critical: 'border-red-500',
  high: 'border-orange-500',
  medium: 'border-yellow-500',
  low: 'border-green-500',
};

export const HitlReview: React.FC<HitlReviewProps> = ({
  agentId,
  hitlRequest,
  onComplete,
}) => {
  const { t } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [denyReason, setDenyReason] = useState('');
  const [showDenyInput, setShowDenyInput] = useState(false);

  const handleApprove = useCallback(async () => {
    setIsProcessing(true);
    try {
      await invoke('approve_hitl', { requestId: hitlRequest.requestId });
      onComplete();
    } catch (error) {
      console.error('Failed to approve HITL request:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [hitlRequest.requestId, onComplete]);

  const handleDeny = useCallback(async () => {
    if (!denyReason.trim()) {
      setShowDenyInput(true);
      return;
    }

    setIsProcessing(true);
    try {
      await invoke('deny_hitl', {
        requestId: hitlRequest.requestId,
        reason: denyReason,
      });
      onComplete();
    } catch (error) {
      console.error('Failed to deny HITL request:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [hitlRequest.requestId, denyReason, onComplete]);

  const handleCancelDeny = useCallback(() => {
    setShowDenyInput(false);
    setDenyReason('');
  }, []);

  return (
    <div
      className={`p-4 bg-gray-800 border-t-2 ${RISK_LEVEL_BORDER[hitlRequest.riskLevel]}`}
      data-testid="hitl-review"
    >
      {/* Risk Level Badge */}
      <div className="flex items-center justify-between mb-3">
        <span
          className={`px-2 py-1 text-xs font-bold rounded ${RISK_LEVEL_STYLES[hitlRequest.riskLevel]}`}
          data-testid="risk-level-badge"
        >
          {hitlRequest.riskLevel.toUpperCase()}
        </span>
        <span className="text-gray-400 text-sm">
          Agent: {agentId}
        </span>
      </div>

      {/* Tool Info */}
      <div className="mb-3">
        <div className="text-gray-400 text-sm mb-1">
          {t('hitl.toolName', 'Tool')}:
        </div>
        <div className="text-white font-medium">
          {hitlRequest.toolName}
        </div>
      </div>

      {/* Input */}
      <div className="mb-4">
        <div className="text-gray-400 text-sm mb-1">
          {t('hitl.input', 'Input')}:
        </div>
        <pre className="bg-gray-900 p-2 rounded text-sm text-gray-300 overflow-auto max-h-40 font-mono">
          {JSON.stringify(hitlRequest.input, null, 2)}
        </pre>
      </div>

      {/* Deny Reason Input (conditional) */}
      {showDenyInput && (
        <div className="mb-4">
          <input
            type="text"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            placeholder={t('hitl.denyReasonPlaceholder', 'Enter reason for denial...')}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white placeholder-gray-500"
            autoFocus
            data-testid="deny-reason-input"
          />
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        {!showDenyInput ? (
          <>
            <button
              onClick={handleApprove}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white font-medium rounded transition-colors"
              data-testid="approve-button"
            >
              {t('hitl.approve', 'Approve')}
            </button>
            <button
              onClick={handleDeny}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 text-white font-medium rounded transition-colors"
              data-testid="deny-button"
            >
              {t('hitl.deny', 'Deny')}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleCancelDeny}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-medium rounded transition-colors"
            >
              {t('hitl.cancel', 'Cancel')}
            </button>
            <button
              onClick={handleDeny}
              disabled={isProcessing || !denyReason.trim()}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 text-white font-medium rounded transition-colors"
              data-testid="confirm-deny-button"
            >
              {t('hitl.confirmDeny', 'Confirm Deny')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
