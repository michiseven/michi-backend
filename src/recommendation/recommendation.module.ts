import { Module } from '@nestjs/common';
import { DeterministicCandidateRanker } from './deterministic-candidate-ranker';
import { HeuristicRouteOptimizer } from './heuristic-route-optimizer';
import { CANDIDATE_RANKER, ROUTE_CONSTRAINT_VALIDATOR, ROUTE_OPTIMIZER } from './ports';
import { RouteConstraintValidator } from './route-constraint-validator';
import { DistanceBasedRoutingProvider } from '../routing/distance-based-routing.provider';
import { ROUTING_PROVIDER } from '../routing/routing-provider';
import { ConfigService } from '@nestjs/config';
import { NaverDirectionsRoutingProvider } from '../routing/naver-directions-routing.provider';
import { SeoulSubwayRoutingProvider } from '../routing/seoul-subway-routing.provider';
import { SeoulBusRoutingProvider } from '../routing/seoul-bus-routing.provider';
import { CompositeRoutingProvider } from '../routing/composite-routing.provider';
import { PedestrianAccessibilityService } from '../routing/pedestrian-accessibility.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PedestrianAccessibilityFeature } from '../database/entities';
import { TransitModule } from '../transit/transit.module';

@Module({
  imports: [TypeOrmModule.forFeature([PedestrianAccessibilityFeature]), TransitModule],
  providers: [
    DeterministicCandidateRanker,
    HeuristicRouteOptimizer,
    RouteConstraintValidator,
    DistanceBasedRoutingProvider,
    NaverDirectionsRoutingProvider,
    SeoulSubwayRoutingProvider,
    SeoulBusRoutingProvider,
    CompositeRoutingProvider,
    PedestrianAccessibilityService,
    {
      provide: ROUTING_PROVIDER,
      inject: [ConfigService, DistanceBasedRoutingProvider, CompositeRoutingProvider],
      useFactory: (
        config: ConfigService,
        distance: DistanceBasedRoutingProvider,
        composite: CompositeRoutingProvider,
      ): import('../routing/routing-provider').RoutingProvider =>
        config.get<string>('ROUTING_PROVIDER_MODE') === 'live' ? composite : distance,
    },
    { provide: CANDIDATE_RANKER, useExisting: DeterministicCandidateRanker },
    { provide: ROUTE_OPTIMIZER, useExisting: HeuristicRouteOptimizer },
    { provide: ROUTE_CONSTRAINT_VALIDATOR, useExisting: RouteConstraintValidator },
  ],
  exports: [
    CANDIDATE_RANKER,
    ROUTE_OPTIMIZER,
    ROUTE_CONSTRAINT_VALIDATOR,
    ROUTING_PROVIDER,
    PedestrianAccessibilityService,
    SeoulSubwayRoutingProvider,
    SeoulBusRoutingProvider,
  ],
})
export class RecommendationModule {}
