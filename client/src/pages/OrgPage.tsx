import React, { useEffect, useRef, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { OrgChart } from "d3-org-chart";
import { orgData } from "../store/org-dummy-data";
import { ZoomIn, ZoomOut, Maximize2, Users } from "lucide-react";
import { Button } from "../components/ui/button";

interface OrgEmployee {
  id: string;
  parentId: string;
  name: string;
  lastName: string;
  position: string;
  image: string;
  department_name?: string;
  email?: string;
  phone_number?: string;
  _highlighted?: boolean;
  _upToTheRootHighlighted?: boolean;
}

const OrgPage: React.FC = () => {
  const { id: paramId } = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [zoomLevel, setZoomLevel] = useState<number>(75);

  const d3Container = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  const activeId = paramId || searchParams.get("id");

  // Transform org dummy data to ensure string IDs and valid parent IDs
  const transformedData: OrgEmployee[] = useMemo(() => {
    return orgData.map((person) => ({
      ...person,
      id: String(person.id),
      parentId:
        person.parentId !== null && person.parentId !== undefined
          ? String(person.parentId)
          : "",
    }));
  }, []);

  const activeEmployee = useMemo(() => {
    if (!activeId) return null;
    return transformedData.find((p) => p.id === String(activeId)) || null;
  }, [activeId, transformedData]);

  // Initialize OrgChart
  useEffect(() => {
    if (!d3Container.current) return;

    // Clear previous SVG if any exists to support Strict Mode cleanly
    d3Container.current.innerHTML = "";

    const chart = new OrgChart();
    chartRef.current = chart;

    chart
      .container(d3Container.current)
      .data(transformedData)
      .nodeWidth(() => 270)
      .nodeHeight(() => 135)
      .childrenMargin(() => 45)
      .compactMarginBetween(() => 30)
      .compactMarginPair(() => 40)
      .initialZoom(1)
      .scaleExtent([0.2, 3])
      .nodeButtonWidth(() => 28)
      .nodeButtonHeight(() => 28)
      .nodeButtonX(() => -14)
      .nodeButtonY(() => -14)
      .buttonContent(({ node }: any) => {
        const isOpen = Boolean(node.children);
        const iconSvg = isOpen
          ? `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>`
          : `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

        return `
          <div class="w-full h-full rounded-full flex items-center justify-center bg-card text-muted-foreground hover:text-foreground shadow-sm border border-border transition-colors">
            ${iconSvg}
          </div>
        `;
      })
      .nodeUpdate(function (this: SVGElement) {
        const rect = this.querySelector(".node-rect");
        if (rect) {
          rect.setAttribute("stroke", "none");
          rect.setAttribute("stroke-width", "0");
        }
      })
      .linkUpdate(function (this: SVGPathElement, d: any) {
        const isHighlighted = !!d.data?._upToTheRootHighlighted;
        this.setAttribute(
          "stroke",
          isHighlighted ? "hsl(var(--primary))" : "hsl(var(--border))",
        );
        this.setAttribute("stroke-width", isHighlighted ? "2.5" : "1.5");
        this.setAttribute("stroke-opacity", isHighlighted ? "1" : "0.7");
        if (isHighlighted && this.parentNode) {
          this.parentNode.appendChild(this);
        }
      })
      .onZoom((e: any) => {
        if (e?.transform?.k) {
          setZoomLevel(Math.round(e.transform.k * 100));
        }
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .nodeContent((d: any) => {
        const fullName = `${d.data.name || ""} ${d.data.lastName || ""}`.trim();
        const avatar =
          d.data.image ||
          "https://bumbeishvili.github.io/avatars/avatars/portrait12.png";
        const position = d.data.position || "Team Member";
        const department = d.data.department_name || "General";
        const id = d.data.id;

        return `
          <div class="relative w-full h-full rounded-xl p-3.5 flex flex-col justify-between text-left box-border bg-card text-card-foreground shadow-sm cursor-pointer transition-all duration-200 border border-border hover:border-primary/50">
            <div class="flex items-center gap-3 overflow-hidden">
              <img 
                src="${avatar}" 
                alt="${fullName}" 
                class="w-12 h-12 rounded-full object-cover border-2 shrink-0 bg-muted border-border" 
                onerror="this.src='https://bumbeishvili.github.io/avatars/avatars/portrait12.png'"
              />
              <div class="flex flex-col min-w-0 overflow-hidden">
                <div class="text-sm font-semibold text-card-foreground truncate" title="${fullName}">${fullName}</div>
                <div class="text-xs text-muted-foreground truncate mt-0.5" title="${position}">${position}</div>
              </div>
            </div>
            <div class="flex items-center justify-between mt-2 pt-2 border-t border-border/70 text-xs">
              <span class="bg-secondary text-secondary-foreground border border-border/60 rounded px-1.5 py-0.5 text-[11px] font-medium truncate max-w-[150px]">${department}</span>
              <span class="text-muted-foreground font-mono text-[11px]">#${id}</span>
            </div>
          </div>
        `;
      })
      .render();

    // Initial highlight check on chart setup
    if (activeId) {
      const exists = transformedData.some((p) => p.id === String(activeId));
      if (exists) {
        chart.setUpToTheRootHighlighted(String(activeId)).render();
      }
    } else {
      chart.clearHighlighting().render().fit({ scale: false });
    }

    const initialK = chart.getChartState?.()?.lastTransform?.k;
    if (initialK) {
      setZoomLevel(Math.round(initialK * 100));
    }
  }, [transformedData, navigate]);

  // Handle route/query param ID updates
  useEffect(() => {
    if (!chartRef.current) return;

    if (activeId) {
      const exists = transformedData.some((p) => p.id === String(activeId));
      if (exists) {
        chartRef.current.setUpToTheRootHighlighted(String(activeId)).render();
      } else {
        chartRef.current.clearHighlighting().render().fit({ scale: false });
      }
    } else {
      chartRef.current.clearHighlighting().render().fit({ scale: false });
    }

    const currentK = chartRef.current?.getChartState?.()?.lastTransform?.k;
    if (currentK) {
      setZoomLevel(Math.round(currentK * 100));
    }
  }, [activeId, transformedData]);

  const handleShowAll = () => {
    navigate("/org");
  };

  const handleZoomIn = () => {
    const state = chartRef.current?.getChartState?.();
    if (state?.svg && state?.zoomBehavior) {
      state.svg
        .transition()
        .duration(250)
        .call(state.zoomBehavior.scaleBy, 1.25);
    } else {
      chartRef.current?.zoomIn?.();
    }
  };

  const handleZoomOut = () => {
    const state = chartRef.current?.getChartState?.();
    if (state?.svg && state?.zoomBehavior) {
      state.svg
        .transition()
        .duration(250)
        .call(state.zoomBehavior.scaleBy, 0.8);
    } else {
      chartRef.current?.zoomOut?.();
    }
  };

  const handleResetZoom = () => {
    const state = chartRef.current?.getChartState?.();
    if (state?.svg && state?.zoomBehavior) {
      state.svg
        .transition()
        .duration(300)
        .call(state.zoomBehavior.scaleTo, 0.75);
    }
  };

  const handleFit = () => {
    chartRef.current?.fit?.();
  };

  return (
    <div className="relative w-full h-full flex-1 min-h-0 overflow-hidden">
      {/* Floating Toolbar Controls */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2 bg-background/80 backdrop-blur-md p-1.5 rounded-lg shadow-sm">
        {activeEmployee && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleShowAll}
            className="gap-1.5 text-xs h-8"
            title="Show Whole Org"
          >
            <Users className="h-4 w-4" />
            <span>Show Whole Org</span>
          </Button>
        )}

        <Button
          variant="outline"
          size="icon"
          onClick={handleZoomOut}
          className="h-8 w-8"
          title="Zoom Out"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleResetZoom}
          className="h-8 min-w-[58px] px-2.5 text-xs font-mono"
          title="Click to reset zoom to 75%"
        >
          {zoomLevel}%
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={handleZoomIn}
          className="h-8 w-8"
          title="Zoom In"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={handleFit}
          className="gap-1.5 text-xs h-8"
          title="Fit to Screen"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span>Fit</span>
        </Button>
      </div>

      {/* D3 Org Chart Canvas Container */}
      <div
        ref={d3Container}
        className="w-full h-full relative overflow-hidden [&_svg]:!w-full [&_svg]:!h-full [&_svg]:cursor-grab [&_svg:active]:cursor-grabbing [&_.link]:transition-[stroke,stroke-width] [&_.link]:duration-200 [&_.node-button-div]:!bg-transparent [&_.node-button-div]:!border-none [&_.node-button-div]:!p-0 [&_.node-rect]:!stroke-none [&_.node-rect]:!stroke-0 [&_.node-rect]:!fill-none"
      />
    </div>
  );
};

export default OrgPage;
