import React from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/useAuth";
import { useDashboardContext } from "@/context/useDashboardContext";
import { useScoringConfig } from "../hooks/useScoringConfig";
import { useScoringData } from "../hooks/useScoringData";
import { useScoringHistory } from "../hooks/useScoringHistory";
import { ScoringConfigPanel } from "./ScoringConfigPanel";
import { ScoringFilters } from "./ScoringFilters";
import { ScoringKPIs } from "./ScoringKPIs";
import { ScoringCharts } from "./ScoringCharts";
import { ScoringLeadsTable } from "./ScoringLeadsTable";
import { ScoringHistoryDialog } from "./ScoringHistoryDialog";

const LeadScoringLayer: React.FC = () => {
    const { loading } = useDashboardContext();
    const { role } = useAuth();

    const scoringConfig = useScoringConfig();
    const {
        activeScoreAttributeKey,
        activeScoreThresholds,
        activeAppointmentLabels,
        selectedScoreAttribute,
        actualLabels,
    } = scoringConfig;

    const scoringData = useScoringData({
        activeScoreAttributeKey,
        activeScoreThresholds,
        activeAppointmentLabels,
        selectedScoreAttribute,
        actualLabels,
    });

    const scoringHistory = useScoringHistory();

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-bold tracking-tight">Calidad de leads</h2>
                <p className="text-sm text-muted-foreground">
                    La calidad del lead se calcula con un campo numérico configurado. El tablero usa la información más actual disponible y la complementa con el historial.
                </p>
            </div>

            <ScoringConfigPanel role={role} {...scoringConfig} />

            <ScoringFilters
                campaignFilter={scoringData.campaignFilter}
                setCampaignFilter={scoringData.setCampaignFilter}
                labelFilters={scoringData.labelFilters}
                setLabelFilters={scoringData.setLabelFilters}
                ownerFilter={scoringData.ownerFilter}
                setOwnerFilter={scoringData.setOwnerFilter}
                bucketFilter={scoringData.bucketFilter}
                setBucketFilter={scoringData.setBucketFilter}
                filterOptions={scoringData.filterOptions}
            />

            <ScoringKPIs
                kpis={scoringData.kpis}
                scoredLeadCount={scoringData.scoredLeadCount}
                filteredMissingScoreCount={scoringData.filteredMissingScoreCount}
                hotLeads={scoringData.hotLeads}
                coldLeads={scoringData.coldLeads}
                hotAppointments={scoringData.hotAppointments}
                activeAppointmentLabels={activeAppointmentLabels}
            />

            <ScoringCharts
                filteredLeads={scoringData.filteredLeads}
                bucketDistribution={scoringData.bucketDistribution}
                averageByChannel={scoringData.averageByChannel}
                averageByDimension={scoringData.averageByDimension}
                conversionByBucket={scoringData.conversionByBucket}
                scoreDomain={scoringData.scoreDomain}
                scoreDimension={scoringData.scoreDimension}
                setScoreDimension={scoringData.setScoreDimension}
                activeAppointmentLabels={activeAppointmentLabels}
            />

            <ScoringLeadsTable
                scoreFieldLabel={scoringData.scoreFieldLabel}
                activeFilterSummary={scoringData.activeFilterSummary}
                detailRows={scoringData.detailRows}
                detailSearch={scoringData.detailSearch}
                setDetailSearch={scoringData.setDetailSearch}
                openHistory={scoringHistory.openHistory}
            />

            <ScoringHistoryDialog
                viewingLead={scoringHistory.viewingLead}
                historyMessages={scoringHistory.historyMessages}
                loadingHistory={scoringHistory.loadingHistory}
                closeHistory={scoringHistory.closeHistory}
                openInChatwoot={scoringHistory.openInChatwoot}
            />
        </div>
    );
};

export default LeadScoringLayer;
