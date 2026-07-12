import { Component, inject, signal, computed, effect, ElementRef, viewChild, afterNextRender, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataService } from '../services/data.service';
import { KnowledgeEntity, KnowledgeEdge, KnowledgeViewResponse, AuditGraphResponse, GraphSchemaMode, KnowledgeCrossReference } from '../models/data.models';

interface GraphNode {
  id: string;
  label: string;
  section: string;
  entityType: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  source: 'knowledge' | 'audit';
  data: KnowledgeEntity;
}

interface GraphLink {
  source: GraphNode;
  target: GraphNode;
  type: string;
}

@Component({
  selector: 'app-graph-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="h-full flex flex-col bg-gray-50 dark:bg-gray-900 transition-colors">
      <!-- Toolbar -->
      <div class="h-12 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between px-4 shadow-sm z-10 gap-3 flex-shrink-0 transition-colors">
        
        <!-- Schema Toggle Buttons -->
        <div class="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5 shadow-sm">
          <button
            (click)="graphSchema.set('knowledge')"
            class="px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200"
            [class]="graphSchema() === 'knowledge'
              ? 'bg-white dark:bg-gray-600 text-blue-700 dark:text-blue-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          >Knowledge</button>
          <button
            (click)="graphSchema.set('audit')"
            class="px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200"
            [class]="graphSchema() === 'audit'
              ? 'bg-white dark:bg-gray-600 text-purple-700 dark:text-purple-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          >Audit</button>
          <button
            (click)="graphSchema.set('combined')"
            class="px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200"
            [class]="graphSchema() === 'combined'
              ? 'bg-white dark:bg-gray-600 text-emerald-700 dark:text-emerald-300 shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
          >Combined</button>
        </div>

        <!-- Center: Graph Info -->
        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          @if (loading()) {
            <span class="inline-flex items-center gap-1">
              <svg class="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Loading...
            </span>
          }
          <span><strong>{{ nodes().length }}</strong> nodes</span>
          <span><strong>{{ links.length }}</strong> edges</span>
          @if (selectedNode(); as sel) {
            <span class="text-blue-600 dark:text-blue-400 font-medium">· {{ sel.label }}</span>
          }
        </div>

        <!-- Right Controls -->
        <div class="flex items-center gap-2">
          <!-- Show Cross-References Toggle -->
          <label class="flex items-center gap-1.5 cursor-pointer select-none">
            <input 
              type="checkbox" 
              [ngModel]="showCrossReferences()" 
              (ngModelChange)="showCrossReferences.set($event)"
              class="h-3.5 w-3.5 text-blue-600 rounded border-gray-300 dark:border-gray-600 focus:ring-blue-500"
            >
            <span class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">X-Refs</span>
          </label>

          <div class="w-px h-5 bg-gray-200 dark:bg-gray-600"></div>

          <!-- Filter by selected node from hierarchy -->
          @if (dataService.selectedFeatureId() || dataService.selectedSubsystemId() || dataService.selectedSystemId()) {
            <span class="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded font-medium">
              Filtered
            </span>
          }

          <!-- Side Panel Toggle -->
          <button 
            (click)="showSidePanel.set(!showSidePanel())"
            class="p-1.5 rounded-lg transition-colors"
            [class]="showSidePanel()
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'"
            title="Toggle Details Panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" />
            </svg>
          </button>

          <!-- Legend Toggle -->
          <button 
            (click)="showLegend.set(!showLegend())"
            class="p-1.5 rounded-lg transition-colors"
            [class]="showLegend()
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30'
              : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'"
            title="Toggle Legend"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13h6m-3-3v6m4-8a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </button>

          <div class="w-px h-5 bg-gray-200 dark:bg-gray-600"></div>

          <!-- Reset / Re-center -->
          <button 
            (click)="resetView()"
            class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Reset View"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          <!-- Zoom controls -->
          <button 
            (click)="zoomIn()"
            class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Zoom In"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </button>
          <button 
            (click)="zoomOut()"
            class="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Zoom Out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Canvas Area + Side Panel -->
      <div class="flex-1 flex overflow-hidden">
        <div class="flex-1 relative overflow-hidden">
          <canvas 
            #graphCanvas
            class="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing"
            (mousedown)="onMouseDown($event)"
            (mousemove)="onMouseMove($event)"
            (mouseup)="onMouseUp($event)"
            (wheel)="onWheel($event)"
            (dblclick)="onDoubleClick($event)"
          ></canvas>

          <!-- Loading Overlay -->
          @if (loading()) {
            <div class="absolute inset-0 flex items-center justify-center bg-gray-50/80 dark:bg-gray-900/80 z-10">
              <div class="flex flex-col items-center gap-2">
                <svg class="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <span class="text-sm text-gray-500 dark:text-gray-400 font-medium">Loading graph data...</span>
              </div>
            </div>
          }

          <!-- Empty State -->
          @if (!loading() && nodes().length === 0) {
            <div class="absolute inset-0 flex items-center justify-center z-10">
              <div class="text-center max-w-sm">
                <div class="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-emerald-100 to-teal-100 dark:from-emerald-900/30 dark:to-teal-900/30 flex items-center justify-center">
                  <svg class="w-8 h-8 text-emerald-500 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </div>
                <p class="text-gray-400 dark:text-gray-500 font-medium">No graph data available</p>
                <p class="text-gray-400 dark:text-gray-500 text-sm mt-1">Select a different schema or check the database.</p>
              </div>
            </div>
          }

          <!-- Node Tooltip -->
          @if (hoveredNode(); as hNode) {
            <div 
              class="absolute z-20 pointer-events-none"
              [style.left.px]="tooltipX()"
              [style.top.px]="tooltipY()"
            >
              <div class="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl px-3 py-2 max-w-xs">
                <div class="flex items-center gap-2 mb-1">
                  <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" [style.background-color]="hNode.color"></span>
                  <span class="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{{ hNode.label }}</span>
                </div>
                <div class="text-[10px] text-gray-500 dark:text-gray-400 space-y-0.5">
                  <div>{{ hNode.section }} · {{ hNode.entityType }}</div>
                  <div class="flex items-center gap-2">
                    <span>{{ hNode.source === 'knowledge' ? 'Knowledge Graph' : 'Audit Record' }}</span>
                    <span class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-semibold">
                      <svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      {{ getNodeDegree(hNode) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          }

          <!-- Legend Panel -->
          @if (showLegend()) {
            <div class="absolute bottom-4 left-4 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-4 max-w-[240px] select-none">
              <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Legend</span>
                <button 
                  (click)="showLegend.set(false)"
                  class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <!-- Node Size Groups -->
              <div class="mb-3">
                <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Node Size = Connections</div>
                <div class="space-y-1.5">
                  @for (g of legendGroups(); track g.label) {
                    <div class="flex items-center gap-2">
                      <span
                        class="rounded-full flex-shrink-0 border border-gray-300 dark:border-gray-600"
                        [style.width.px]="(g.radius * 1.2) || 8"
                        [style.height.px]="(g.radius * 1.2) || 8"
                        style="background: #6B7280"
                      ></span>
                      <span class="text-[11px] text-gray-600 dark:text-gray-400">{{ g.label }}</span>
                    </div>
                  }
                </div>
              </div>

              <!-- Edge Types -->
              <div class="mb-3">
                <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Edges</div>
                <div class="space-y-1.5">
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-0.5 bg-gray-400 dark:bg-gray-500 flex-shrink-0"></div>
                    <span class="text-[11px] text-gray-600 dark:text-gray-400">Relation</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-0 border-t border-dashed border-yellow-500 flex-shrink-0" style="border-top-width: 2px"></div>
                    <span class="text-[11px] text-gray-600 dark:text-gray-400">Cross-Reference</span>
                  </div>
                  <div class="flex items-center gap-2 mt-2">
                    <svg class="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                      <polygon points="8,2 12,8 8,6 4,8" />
                    </svg>
                    <span class="text-[11px] text-gray-600 dark:text-gray-400">Direction (→)</span>
                  </div>
                </div>
              </div>

              <!-- Colors -->
              <div>
                <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Colors</div>
                <p class="text-[10px] text-gray-500 dark:text-gray-500 leading-relaxed">
                  Knowledge nodes are colored by section; audit nodes by record type.
                </p>
              </div>
            </div>
          }
        </div>

        <!-- Side Panel -->
        @if (showSidePanel()) {
          <div class="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col overflow-hidden flex-shrink-0 z-10">
            @if (selectedNode(); as sel) {
              <!-- Panel Header -->
              <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="w-3 h-3 rounded-full flex-shrink-0" [style.background-color]="sel.color"></span>
                  <span class="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{{ sel.label }}</span>
                </div>
                <button 
                  (click)="deselectNode()"
                  class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0 transition-colors"
                  title="Deselect (Esc)"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <!-- Panel Content (scrollable) -->
              <div class="flex-1 overflow-y-auto p-3 space-y-3">
                <!-- Metadata Badges -->
                <div class="flex flex-wrap gap-1.5">
                  <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400">{{ sel.entityType }}</span>
                  <span 
                    class="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    [style.background]="sel.color + '20'"
                    [style.color]="sel.color"
                  >{{ sel.section }}</span>
                  <span 
                    class="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    [class]="sel.source === 'knowledge' 
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' 
                      : 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'"
                  >{{ sel.source === 'knowledge' ? 'Knowledge' : 'Audit' }}</span>
                  @if (sel.data.status) {
                    <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">{{ sel.data.status }}</span>
                  }
                </div>

                <!-- Entity ID -->
                @if (sel.data.entity_id) {
                  <div class="pt-1">
                    <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-0.5">ID</div>
                    <code class="text-[11px] text-gray-600 dark:text-gray-400 font-mono bg-gray-50 dark:bg-gray-900/50 px-1.5 py-0.5 rounded">{{ sel.data.entity_id }}</code>
                  </div>
                }

                <!-- Description -->
                @if (sel.data.description) {
                  <div>
                    <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Description</div>
                    <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{{ sel.data.description }}</p>
                  </div>
                }

                <!-- Properties -->
                @if (sel.data.properties) {
                  <div>
                    <div class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Properties</div>
                    <div class="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-2 max-h-48 overflow-y-auto">
                      <pre class="text-[10px] text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono">{{ formatProperties(sel.data.properties) }}</pre>
                    </div>
                  </div>
                }

                <!-- Connected Nodes -->
                @if (selectedNodeEdges().length > 0) {
                  <div>
                    <div class="flex items-center gap-2 mb-1.5">
                      <span class="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Connections ({{ selectedNodeEdges().length }})</span>
                      <div class="relative flex-1">
                        <input
                          type="text"
                          [ngModel]="connectionFilter()"
                          (ngModelChange)="connectionFilter.set($event)"
                          class="w-full h-6 pl-5 pr-1.5 text-[10px] bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded placeholder-gray-400 dark:placeholder-gray-500 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                          placeholder="Filter…"
                          (click)="$event.stopPropagation()"
                        >
                        <svg class="absolute left-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 dark:text-gray-500 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                    </div>
                    <div class="space-y-1">
                      @for (edge of filteredEdges(); track $index) {
                        <div 
                          class="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                          (click)="focusNode(edge.other.id)"
                        >
                          <span class="w-2 h-2 rounded-full flex-shrink-0" [style.background-color]="edge.other.color"></span>
                          <div class="min-w-0 flex-1">
                            <div class="text-xs text-gray-700 dark:text-gray-300 truncate font-medium">{{ edge.other.label }}</div>
                            <div class="text-[9px] text-gray-400 dark:text-gray-500">
                              <span class="font-mono">{{ edge.direction }}</span> {{ edge.type }}
                            </div>
                          </div>
                        </div>
                      }
                      @if (filteredEdges().length === 0 && connectionFilter()) {
                        <div class="text-[10px] text-gray-400 dark:text-gray-500 text-center py-2 italic">No matches</div>
                      }
                    </div>
                  </div>
                }

                <!-- Timestamps -->
                <div class="pt-2 border-t border-gray-100 dark:border-gray-700">
                  @if (sel.data.created_at) {
                    <div class="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 py-0.5">
                      <span>Created</span>
                      <span class="font-mono">{{ sel.data.created_at }}</span>
                    </div>
                  }
                  @if (sel.data.updated_at) {
                    <div class="flex justify-between text-[10px] text-gray-400 dark:text-gray-500 py-0.5">
                      <span>Updated</span>
                      <span class="font-mono">{{ sel.data.updated_at }}</span>
                    </div>
                  }
                </div>
              </div>
            } @else {
              <!-- Empty State: Panel open, no node selected -->
              <div class="flex-1 flex items-center justify-center p-6">
                <div class="text-center">
                  <svg class="w-10 h-10 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                  </svg>
                  <p class="text-xs font-medium text-gray-400 dark:text-gray-500">No node selected</p>
                  <p class="text-[10px] text-gray-400 dark:text-gray-500 mt-1">Click a node on the graph to view its details.</p>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Status Bar -->
      <div class="h-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 transition-colors">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Knowledge
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span> Audit
          </span>
          @if (selectedNode(); as sel) {
            <span class="text-blue-600 dark:text-blue-400 ml-2">Selected: {{ sel.label }}</span>
          }
        </div>
        <div class="ml-auto">Drag to pan · Scroll to zoom · Click node to select</div>
      </div>
    </div>
  `
})
export class GraphViewComponent implements OnDestroy {
  dataService = inject(DataService);

  readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('graphCanvas');

  // State
  graphSchema = signal<GraphSchemaMode>('knowledge');
  showCrossReferences = signal(false);
  showLegend = signal(false);
  showSidePanel = signal(false);
  loading = signal(false);

  nodes = signal<GraphNode[]>([]);
  links: GraphLink[] = [];

  // Canvas state
  private ctx: CanvasRenderingContext2D | null = null;
  private animationId: number | null = null;
  private simulationRunning = false;
  private resizeObserver: ResizeObserver | null = null;

  // Interaction state
  hoveredNode = signal<GraphNode | null>(null);
  selectedNode = signal<GraphNode | null>(null);
  tooltipX = signal(0);
  tooltipY = signal(0);

  // Pan / Zoom
  private cameraX = 0;
  private cameraY = 0;
  private cameraScale = 1;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private cameraStartX = 0;
  private cameraStartY = 0;
  private isPanning = false;

  // Node dragging
  private draggedNode: GraphNode | null = null;
  private dragMoved = false;

  // Pinned nodes — manually dragged nodes that should not move during simulation
  private pinnedNodes = new Set<GraphNode>();

  // Auto-fit tracking — ensures we fit the view after simulation spreads nodes
  private autoFitPending = false;
  private autoFitFrameCount = 0;
  private autoFitInterval: number | null = null;

  // Knowledge data cache
  private knowledgeData: KnowledgeViewResponse | null = null;
  private auditData: AuditGraphResponse | null = null;
  private crossReferenceData: KnowledgeCrossReference[] = [];

  // Color mapping by section
  private sectionColors: Record<string, string> = {};
  private readonly COLOR_PALETTE = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#6366F1',
    '#14B8A6', '#F43F5E',
  ];

  constructor() {
    // Load data when schema changes
    effect(() => {
      const schema = this.graphSchema();
      this.loadGraphData(schema);
    });

    // Escape key to deselect node
    document.addEventListener('keydown', this.handleKeyDown);

    // Render loop + resize observer
    afterNextRender(() => {
      this.initCanvas();
      this.startSimulation();
      // Observe parent for resize (sidebar changes etc.)
      const canvasEl = this.canvasRef()?.nativeElement;
      if (canvasEl && canvasEl.parentElement) {
        this.resizeObserver = new ResizeObserver(() => {
          this.resizeCanvas();
        });
        this.resizeObserver.observe(canvasEl.parentElement);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopSimulation();
    document.removeEventListener('keydown', this.handleKeyDown);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  // ── Legend (connection-count based) ─────────────────────────────

  /** Legend computed from actual degree-based sizing */
  legendGroups = computed(() => {
    const nodes = this.nodes();
    if (nodes.length === 0) return [];
    const degrees = nodes.map(n => (n as any).degree || 0);
    const minDeg = Math.min(...degrees);
    const maxDeg = Math.max(...degrees);
    const minRad = Math.min(...nodes.map(n => n.radius));
    const maxRad = Math.max(...nodes.map(n => n.radius));
    const midDeg = Math.round((minDeg + maxDeg) / 2);
    // Show up to 3 size tiers
    const tiers: { radius: number; label: string }[] = [
      { radius: maxRad, label: `Most connected — ${maxDeg} edge${maxDeg !== 1 ? 's' : ''}` },
    ];
    if (midDeg > minDeg && midDeg < maxDeg) {
      tiers.push({ radius: Math.round((minRad + maxRad) / 2) || maxRad, label: `Mid — ${midDeg} edge${midDeg !== 1 ? 's' : ''}` });
    }
    if (minDeg < maxDeg) {
      tiers.push({ radius: minRad || 4, label: `Fewest — ${minDeg} edge${minDeg !== 1 ? 's' : ''}` });
    }
    return tiers;
  });

  // ── Data Loading ────────────────────────────────────────────────

  private async loadGraphData(schema: GraphSchemaMode) {
    this.loading.set(true);
    try {
      if (schema === 'knowledge' || schema === 'combined') {
        this.knowledgeData = await this.dataService.fetchKnowledgeView(500);
      }
      if (schema === 'audit' || schema === 'combined') {
        this.auditData = await this.dataService.fetchAuditGraph(200);
      }
      if (this.showCrossReferences()) {
        this.crossReferenceData = await this.dataService.fetchKnowledgeCrossReferences(500);
      }
      this.buildGraph(schema);
    } catch (err) {
      console.error('Failed to load graph data:', err);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Schedule the first auto-fit. After the initial synchronous buildGraph call,
   * nodes are still clustered near the center (random initial positions). The
   * simulation takes time to spread them into their force-directed layout.
   * We schedule a short delay before the first fit so some spreading has occurred,
   * then rely on periodic refits during simulation + a final fit on settle.
   */
  private scheduleAutoFit() {
    this.autoFitPending = true;
    this.autoFitFrameCount = 0;

    // Fit immediately with whatever current positions exist (won't be great,
    // but better than nothing)
    this.autoFitView();

    // Also schedule a delayed fit after the simulation has had time to spread
    // nodes out from their tight initial cluster (using a timer rather than
    // frame-count so it fires even if the main simulation loop pauses)
    setTimeout(() => {
      if (this.autoFitPending) {
        this.autoFitView();
      }
    }, 2000);
  }

  private buildGraph(schema: GraphSchemaMode) {
    // Clear selection + pinned nodes to avoid stale references after rebuild
    this.deselectNode();
    this.pinnedNodes.clear();
    const nodeMap = new Map<string, GraphNode>();
    const linkList: { sourceId: string; targetId: string; type: string }[] = [];
    const centerX = 0;
    const centerY = 0;
    let colorIndex = 0;
    this.autoFitPending = true;

    const getColor = (section: string, source: 'knowledge' | 'audit'): string => {
      if (source === 'audit') {
        const auditColors: Record<string, string> = {
          'report': '#8B5CF6', 'analysis': '#A78BFA', 'assessment': '#C4B5FD',
          'inspection': '#7C3AED', 'prompt': '#6D28D9', 'response': '#5B21B6',
          'engineering_log': '#9333EA', 'architecture_note': '#7E22CE', 'decision': '#4C1D95',
        };
        return auditColors[section] || '#8B5CF6';
      }
      const key = `${source}:${section}`;
      if (!this.sectionColors[key]) {
        this.sectionColors[key] = this.COLOR_PALETTE[colorIndex++ % this.COLOR_PALETTE.length];
      }
      return this.sectionColors[key];
    };        // Build a lookup for hierarchy filtering:
    // Collect hierarchy names for highlighting matching nodes
    // (highlight amplification happens in the degree-sizing block below)
    const hierarchyNames = new Set<string>();
    const selectedSysId = this.dataService.selectedSystemId();
    const selectedSubId = this.dataService.selectedSubsystemId();
    const selectedFeatId = this.dataService.selectedFeatureId();
    
    let hasHierarchyFilter = false;
    if (selectedSysId || selectedSubId || selectedFeatId) {
      hasHierarchyFilter = true;
      for (const sys of this.dataService.systems()) {
        if (selectedSysId && sys.id !== selectedSysId) continue;
        hierarchyNames.add(sys.name.toLowerCase());
        for (const sub of sys.subsystems) {
          if (selectedSubId && sub.id !== selectedSubId) continue;
          hierarchyNames.add(sub.name.toLowerCase());
          for (const feat of sub.features) {
            if (selectedFeatId && feat.id !== selectedFeatId) continue;
            hierarchyNames.add(feat.name.toLowerCase());
          }
        }
      }
    }

    // Building blocks: collect all highlighted node IDs for later amplification
    const highlightedIds = new Set<string>();

    // Load knowledge entities
    if ((schema === 'knowledge' || schema === 'combined') && this.knowledgeData) {
      for (const entity of this.knowledgeData.entities) {
        const nodeId = `knowledge:${entity.section}:${entity.entity_id}`;
        const isHighlighted = hasHierarchyFilter && (
          hierarchyNames.has(entity.name.toLowerCase()) ||
          hierarchyNames.has(entity.section.toLowerCase())
        );
        if (isHighlighted) highlightedIds.add(nodeId);
        const angle = Math.random() * Math.PI * 2;
        const radius = 50 + Math.random() * 150;
        nodeMap.set(nodeId, {
          id: nodeId,
          label: entity.name,
          section: entity.section,
          entityType: entity.entity_type,
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          radius: 5, // placeholder — will be overwritten by degree sizing
          color: getColor(entity.section, 'knowledge'),
          source: 'knowledge',
          data: entity,
        });
      }
    }

    // Load audit entities
    if ((schema === 'audit' || schema === 'combined') && this.auditData) {
      for (const entity of this.auditData.entities) {
        const nodeId = `audit:${entity.id}`;
        const isHighlighted = hasHierarchyFilter && entity.name && hierarchyNames.has(entity.name.toLowerCase());
        if (isHighlighted) highlightedIds.add(nodeId);
        const angle = Math.random() * Math.PI * 2;
        const radius = 50 + Math.random() * 150;
        nodeMap.set(nodeId, {
          id: nodeId,
          label: entity.name || entity.entity_id,
          section: entity.entity_type || 'record',
          entityType: entity.entity_type || 'agent_record',
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
          radius: 5, // placeholder — will be overwritten by degree sizing
          color: getColor(entity.entity_type, 'audit'),
          source: 'audit',
          data: entity,
        });
      }
    }

    // Build links from knowledge edges
    if ((schema === 'knowledge' || schema === 'combined') && this.knowledgeData) {
      for (const edge of this.knowledgeData.edges) {
        const sourceId = `knowledge:${edge.source_section}:${edge.source_id}`;
        const targetId = `knowledge:${edge.target_section}:${edge.target_id}`;
        if (nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          linkList.push({ sourceId, targetId, type: edge.relation_type });
        }
      }
    }

    // Build links from audit cross-references
    if ((schema === 'audit' || schema === 'combined') && this.auditData) {
      for (const edge of this.auditData.edges) {
        const sourceId = `audit:${edge.source_id}`;
        const targetId = `audit:${edge.target_id}`;
        if (nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          linkList.push({ sourceId, targetId, type: edge.relation_type || 'references' });
        }
      }
    }

    // Add cross-reference overlay if enabled
    if (this.showCrossReferences() && (schema === 'knowledge' || schema === 'combined')) {
      for (const xref of this.crossReferenceData) {
        const sourceId = `knowledge:${xref.source_section}:${xref.source_id}`;
        const targetId = `knowledge:${xref.target_section}:${xref.target_id}`;
        if (nodeMap.has(sourceId) && nodeMap.has(targetId)) {
          linkList.push({ sourceId, targetId, type: 'cross-ref' });
        }
      }
    }

    const nodesArray = Array.from(nodeMap.values());

    // Center the nodes
    if (nodesArray.length > 0) {
      const avgX = nodesArray.reduce((s, n) => s + n.x, 0) / nodesArray.length;
      const avgY = nodesArray.reduce((s, n) => s + n.y, 0) / nodesArray.length;
      for (const n of nodesArray) {
        n.x -= avgX;
        n.y -= avgY;
      }
    }

    this.nodes.set(nodesArray);

    // Build typed links
    const nodeLookup = new Map(nodesArray.map(n => [n.id, n]));
    this.links = linkList
      .filter(l => nodeLookup.has(l.sourceId) && nodeLookup.has(l.targetId))
      .map(l => ({
        source: nodeLookup.get(l.sourceId)!,
        target: nodeLookup.get(l.targetId)!,
        type: l.type,
      }));

    // ── Size nodes by connection count ───────────────────────────
    if (this.links.length > 0) {
      const degree = new Map<string, number>();
      for (const n of nodesArray) degree.set(n.id, 0);
      for (const l of this.links) {
        degree.set(l.source.id, (degree.get(l.source.id) || 0) + 1);
        degree.set(l.target.id, (degree.get(l.target.id) || 0) + 1);
      }
      let maxDegree = 1;
      let minDegree = 0;
      for (const d of degree.values()) {
        if (d > maxDegree) maxDegree = d;
        if (d < minDegree) minDegree = d;
      }
      const range = maxDegree - minDegree || 1;
      const minRadius = 4;
      const maxRadius = 18;
      for (const n of nodesArray) {
        const deg = degree.get(n.id) || 0;
        // Logarithmic scale: size = min + (log(1+deg) - log(1+min)) / (log(1+max) - log(1+min)) * range
        if (range > 0) {
          const logMin = Math.log(1 + minDegree);
          const logMax = Math.log(1 + maxDegree);
          const logDeg = Math.log(1 + deg);
          const t = (logDeg - logMin) / (logMax - logMin || 1);
          n.radius = Math.max(minRadius, Math.min(maxRadius, minRadius + t * (maxRadius - minRadius)));
          (n as any).degree = deg;
        } else {
          n.radius = minRadius + (maxRadius - minRadius) * 0.5;
          (n as any).degree = deg;
        }
        // Hierarchy highlight amplification: matched nodes get +4px
        if (highlightedIds.has(n.id)) {
          n.radius += 4;
        }
      }
    }

    // Kick off simulation to let nodes settle into layout
    this.simulationRunning = true;

    // After build, schedule a fit-to-view once the simulation has had time
    // to spread nodes out from their initial clustering.
    // The fit is re-attempted periodically in simulationStep until settled.
    if (nodesArray.length > 0) {
      // Initial fit right after build so nodes are visible immediately
      this.scheduleAutoFit();
    }
  }

  // ── Canvas Initialization ───────────────────────────────────────

  private initCanvas() {
    const canvasEl = this.canvasRef();
    if (!canvasEl) return;
    this.ctx = canvasEl.nativeElement.getContext('2d');
    this.resizeCanvas();
    this.cameraX = 0;
    this.cameraY = 0;
    this.cameraScale = 1;
  }

  private resizeCanvas() {
    const canvasEl = this.canvasRef()?.nativeElement;
    if (!canvasEl) return;
    const parent = canvasEl.parentElement;
    if (!parent) return;
    canvasEl.width = parent.clientWidth;
    canvasEl.height = parent.clientHeight;
  }

  // ── Simulation Loop ─────────────────────────────────────────────

  private startSimulation() {
    if (this.animationId !== null) return;
    const step = () => {
      this.simulationStep();
      this.render();
      this.animationId = requestAnimationFrame(step);
    };
    this.animationId = requestAnimationFrame(step);
  }

  private stopSimulation() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.simulationRunning = false;
    if (this.autoFitInterval !== null) {
      clearInterval(this.autoFitInterval);
      this.autoFitInterval = null;
    }
  }

  private simulationStep() {
    const nodesArray = this.nodes();
    if (nodesArray.length === 0) return;

    const alpha = 0.03;
    const repulsionStrength = 800;
    const attractionStrength = 0.005;
    const centerGravity = 0.001;
    const damping = 0.85;
    const minVelocity = 0.1;

    // Repulsion between all nodes (Barnes-Hut approximation)
    for (let i = 0; i < nodesArray.length; i++) {
      for (let j = i + 1; j < nodesArray.length; j++) {
        const a = nodesArray[i];
        const b = nodesArray[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsionStrength / (dist * dist);
        const fx = (dx / dist) * force * alpha;
        const fy = (dy / dist) * force * alpha;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along edges
    for (const link of this.links) {
      const a = link.source;
      const b = link.target;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 80) * attractionStrength * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    let totalNodes = 0;
    let centerX = 0;
    let centerY = 0;
    for (const n of nodesArray) {
      if (n !== this.draggedNode && !this.pinnedNodes.has(n)) {
        centerX += n.x;
        centerY += n.y;
        totalNodes++;
      }
    }
    if (totalNodes > 0) {
      centerX /= totalNodes;
      centerY /= totalNodes;
      for (const n of nodesArray) {
        if (n !== this.draggedNode && !this.pinnedNodes.has(n)) {
          n.vx += (centerX - n.x) * centerGravity * alpha;
          n.vy += (centerY - n.y) * centerGravity * alpha;
        }
      }
    }

    // Apply velocities with damping
    let totalSpeed = 0;
    for (const n of nodesArray) {
      if (n === this.draggedNode || this.pinnedNodes.has(n)) continue;
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
      totalSpeed += Math.abs(n.vx) + Math.abs(n.vy);
    }

    // Stop simulation when settled
    if (totalSpeed / nodesArray.length < minVelocity && this.links.length > 0) {
      this.simulationRunning = false;
      // Final auto-fit when simulation settles — nodes are in their resting positions
      if (this.autoFitPending) {
        this.autoFitPending = false;
        this.autoFitView();
      }
      return;
    }

    // Periodically re-fit the view while simulation is running to keep visible
    this.autoFitFrameCount++;
    if (this.autoFitPending && this.autoFitFrameCount % 30 === 0) {
      this.autoFitView();
    }
  }

  // ── Rendering ───────────────────────────────────────────────────

  private render() {
    const ctx = this.ctx;
    const canvasEl = this.canvasRef()?.nativeElement;
    if (!ctx || !canvasEl) return;

    // Ensure canvas dimensions match its parent layout
    // This handles edge cases where resizeCanvas hasn't been called yet
    // (e.g., data loads before afterNextRender fires, or layout shifts)
    const parent = canvasEl.parentElement;
    if (parent) {
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      if (pw > 0 && ph > 0 && (canvasEl.width !== pw || canvasEl.height !== ph)) {
        canvasEl.width = pw;
        canvasEl.height = ph;
      }
    }

    const width = canvasEl.width;
    const height = canvasEl.height;

    if (width === 0 || height === 0) return;

    // Clear
    ctx.fillStyle = this.getBackgroundColor();
    ctx.fillRect(0, 0, width, height);

    // Apply camera
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(this.cameraScale, this.cameraScale);
    ctx.translate(this.cameraX, this.cameraY);

    // Determine if hierarchy filter is active (to dim non-matching nodes)
    const hasHierarchyFilter = this.dataService.selectedFeatureId() || this.dataService.selectedSubsystemId() || this.dataService.selectedSystemId();

    // Draw edges
    const nodesArray = this.nodes();
    const nodeIds = new Set(nodesArray.map(n => n.id));

    for (const link of this.links) {
      if (!nodeIds.has(link.source.id) || !nodeIds.has(link.target.id)) continue;

      const source = link.source;
      const target = link.target;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;

      const angle = Math.atan2(dy, dx);

      // Clip line to node boundaries
      const startX = source.x + Math.cos(angle) * source.radius;
      const startY = source.y + Math.sin(angle) * source.radius;
      const endX = target.x - Math.cos(angle) * target.radius;
      const endY = target.y - Math.sin(angle) * target.radius;

      const isCrossRef = link.type === 'cross-ref';
      ctx.strokeStyle = isCrossRef
        ? (this.isDark() ? 'rgba(251, 191, 36, 0.3)' : 'rgba(251, 191, 36, 0.5)')
        : (this.isDark() ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.15)');
      ctx.lineWidth = isCrossRef ? 1 : Math.max(0.5, Math.min(2, 1));

      // Dashed for cross-refs
      if (isCrossRef) {
        ctx.setLineDash([3, 3]);
      } else {
        ctx.setLineDash([]);
      }

      // Draw edge line
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      // ── Arrowhead ──────────────────────────────────────────────────
      const arrowSize = Math.max(4, Math.min(8, this.cameraScale * 6));
      ctx.save();
      ctx.translate(endX, endY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(arrowSize, 0);
      ctx.lineTo(-arrowSize * 0.6, -arrowSize * 0.5);
      ctx.lineTo(-arrowSize * 0.6, arrowSize * 0.5);
      ctx.closePath();
      ctx.fillStyle = isCrossRef
        ? (this.isDark() ? 'rgba(251, 191, 36, 0.5)' : 'rgba(251, 191, 36, 0.7)')
        : (this.isDark() ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.25)');
      ctx.fill();
      ctx.restore();
    }

    ctx.setLineDash([]);

    // Draw nodes
    for (const node of nodesArray) {
      const isSelected = this.selectedNode()?.id === node.id;
      const isHovered = this.hoveredNode()?.id === node.id;
      const isDimmed = hasHierarchyFilter && node.radius <= 7; // only dim small/default nodes

      // Glow for selected
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + Math.min(6, node.radius * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = node.color + '40';
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = isDimmed ? node.color + '30' : node.color;
      ctx.fill();

      // Border
      ctx.strokeStyle = isSelected
        ? '#FFFFFF'
        : (isHovered ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)');
      ctx.lineWidth = isSelected ? 2.5 : (isHovered ? 2 : 1);
      ctx.stroke();

      // Label
      const labelSize = Math.max(9, Math.min(12, this.cameraScale * 10));
      ctx.font = `${labelSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = this.isDark() ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.75)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const labelY = node.y + node.radius + 3;
      const maxWidth = 120;
      const text = node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label;
      ctx.fillText(text, node.x, labelY, maxWidth);
    }

    ctx.restore();
  }

  private getBackgroundColor(): string {
    return this.isDark() ? '#111827' : '#F9FAFB';
  }

  private isDark(): boolean {
    return this.dataService.theme() !== 'light';
  }

  // ── Mouse / Interaction ─────────────────────────────────────────

  private screenToCanvas(sx: number, sy: number): { x: number; y: number } {
    const canvasEl = this.canvasRef()?.nativeElement;
    if (!canvasEl) return { x: sx, y: sy };
    const rect = canvasEl.getBoundingClientRect();
    // Convert viewport-relative mouse coordinates to canvas-local coordinates
    // by subtracting the canvas element's top-left position (rect.left, rect.top).
    // Then apply the inverse of the render transform:
    //   sx = (wx + cameraX) * scale + width/2   →   wx = (sx - width/2) / scale - cameraX
    const cx = (sx - rect.left - rect.width / 2) / this.cameraScale - this.cameraX;
    const cy = (sy - rect.top - rect.height / 2) / this.cameraScale - this.cameraY;
    return { x: cx, y: cy };
  }

  private findNodeAt(sx: number, sy: number): GraphNode | null {
    const { x, y } = this.screenToCanvas(sx, sy);
    const nodesArray = this.nodes();
    for (let i = nodesArray.length - 1; i >= 0; i--) {
      const n = nodesArray[i];
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= (n.radius + 5) * (n.radius + 5)) {
        return n;
      }
    }
    return null;
  }

  onMouseDown(event: MouseEvent) {
    const node = this.findNodeAt(event.clientX, event.clientY);
    if (node) {
      this.draggedNode = node;
      this.isDragging = true;
      this.dragMoved = false;
    } else {
      this.isPanning = true;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.cameraStartX = this.cameraX;
      this.cameraStartY = this.cameraY;
    }
  }

  onMouseMove(event: MouseEvent) {
    if (this.isPanning) {
      const dx = (event.clientX - this.dragStartX) / this.cameraScale;
      const dy = (event.clientY - this.dragStartY) / this.cameraScale;
      this.cameraX = this.cameraStartX + dx;
      this.cameraY = this.cameraStartY + dy;
      return;
    }

    if (this.draggedNode) {
      const { x, y } = this.screenToCanvas(event.clientX, event.clientY);
      const dx = x - this.draggedNode.x;
      const dy = y - this.draggedNode.y;
      if (Math.sqrt(dx * dx + dy * dy) > 3) {
        this.dragMoved = true;
      }
      this.draggedNode.x = x;
      this.draggedNode.y = y;
      this.draggedNode.vx = 0;
      this.draggedNode.vy = 0;
      this.simulationRunning = true;
      return;
    }

    // Hover detection
    const node = this.findNodeAt(event.clientX, event.clientY);
    const canvasEl = this.canvasRef()?.nativeElement;
    if (canvasEl) {
      canvasEl.style.cursor = node ? 'pointer' : 'grab';
    }

    if (node) {
      this.hoveredNode.set(node);
      this.tooltipX.set(event.clientX + 15);
      this.tooltipY.set(event.clientY - 10);
    } else {
      this.hoveredNode.set(null);
    }
  }

  onMouseUp(_event: MouseEvent) {
    if (this.draggedNode) {
      // If dragged, pin it so it stays in place
      if (this.dragMoved) {
        this.pinnedNodes.add(this.draggedNode);
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
      } else {
        // Click (no drag) — select the node
        this.selectedNode.set(this.draggedNode);
        this.showSidePanel.set(true);
      }
      this.draggedNode = null;
    }
    this.isPanning = false;
    this.isDragging = false;
    this.dragMoved = false;
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(5, this.cameraScale * delta));

    // Zoom toward mouse position
    const canvasEl = this.canvasRef()?.nativeElement;
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const mx = event.clientX - rect.left - rect.width / 2;
      const my = event.clientY - rect.top - rect.height / 2;
      this.cameraX -= mx / this.cameraScale - mx / newScale;
      this.cameraY -= my / this.cameraScale - my / newScale;
    }

    this.cameraScale = newScale;
  }

  onDoubleClick(event: MouseEvent) {
    const node = this.findNodeAt(event.clientX, event.clientY);
    if (node) {
      this.selectedNode.set(node);
      this.showSidePanel.set(true);
      // Center camera on clicked node
      this.cameraX = -node.x;
      this.cameraY = -node.y;
      this.cameraScale = 1.5;
    }
  }

  // ── Side Panel Computed ─────────────────────────────────────────

  /** Search term for filtering connections in the side panel */
  connectionFilter = signal('');

  /** Incoming/outgoing edges for the selected node, filtered by search */
  selectedNodeEdges = computed(() => {
    const sel = this.selectedNode();
    if (!sel) return [];
    const edges: { other: GraphNode; direction: string; type: string }[] = [];
    for (const link of this.links) {
      if (link.source.id === sel.id) {
        edges.push({ other: link.target, direction: '→', type: link.type });
      } else if (link.target.id === sel.id) {
        edges.push({ other: link.source, direction: '←', type: link.type });
      }
    }
    return edges;
  });

  /** Connection count for a node, used in hover tooltip */
  getNodeDegree(node: GraphNode): number {
    return (node as any).degree || 0;
  }

  formatProperties(props: any): string {
    if (!props) return '';
    if (typeof props === 'string') return props;
    try {
      return JSON.stringify(props, null, 2);
    } catch {
      return String(props);
    }
  }

  deselectNode() {
    this.selectedNode.set(null);
    this.connectionFilter.set('');
  }

  /** Navigate the graph to focus on a specific node by ID */
  focusNode(nodeId: string) {
    const node = this.nodes().find(n => n.id === nodeId);
    if (node) {
      this.connectionFilter.set('');
      this.selectedNode.set(node);
      this.showSidePanel.set(true);
      this.cameraX = -node.x;
      this.cameraY = -node.y;
      this.cameraScale = 1.5;
    }
  }

  /** Filtered connections based on search term */
  filteredEdges = computed(() => {
    const all = this.selectedNodeEdges();
    const filter = this.connectionFilter().toLowerCase().trim();
    if (!filter) return all;
    return all.filter(e =>
      e.other.label.toLowerCase().includes(filter) ||
      e.type.toLowerCase().includes(filter)
    );
  });

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.deselectNode();
    }
  };

  // ── Toolbar Controls ────────────────────────────────────────────

  /**
   * Auto-fit the view so all nodes are visible with padding.
   * Computes the bounding box of all nodes and adjusts camera position/scale.
   * Called after graph build, periodically during simulation, and on settle.
   */
  private autoFitView() {
    const nodesArray = this.nodes();
    if (nodesArray.length === 0) return;

    const canvasEl = this.canvasRef()?.nativeElement;
    if (!canvasEl) return;

    const canvasWidth = canvasEl.width;
    const canvasHeight = canvasEl.height;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    // Compute bounding box of all nodes
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodesArray) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }

    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;
    if (bboxWidth === 0 && bboxHeight === 0) return;

    const bboxCenterX = (minX + maxX) / 2;
    const bboxCenterY = (minY + maxY) / 2;

    // Padding: 20% of the larger dimension on each side
    const padding = Math.max(bboxWidth, bboxHeight) * 0.2 + 40;
    const paddedWidth = bboxWidth + padding * 2;
    const paddedHeight = bboxHeight + padding * 2;

    // Compute scale to fit padded bounding box in canvas
    const scaleX = canvasWidth / paddedWidth;
    const scaleY = canvasHeight / paddedHeight;
    const newScale = Math.min(scaleX, scaleY);

    // Clamp scale to reasonable limits
    this.cameraScale = Math.max(0.1, Math.min(5, newScale));

    // Center camera on the bounding box center
    this.cameraX = -bboxCenterX;
    this.cameraY = -bboxCenterY;
  }

  resetView() {
    // Reset camera then auto-fit to re-center on all nodes
    this.cameraX = 0;
    this.cameraY = 0;
    this.cameraScale = 1;
    this.selectedNode.set(null);
    this.hoveredNode.set(null);
    // After reset, auto-fit to show all nodes
    setTimeout(() => this.autoFitView(), 0);
  }

  zoomIn() {
    this.cameraScale = Math.min(5, this.cameraScale * 1.3);
  }

  zoomOut() {
    this.cameraScale = Math.max(0.1, this.cameraScale * 0.77);
  }
}
