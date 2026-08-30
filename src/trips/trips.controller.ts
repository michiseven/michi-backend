import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RateLimitGuard } from '../common/guards/rate-limit.guard';
import { GenerateTripDto } from './dto/generate-trip.dto';
import { PatchTripStopsDto } from './dto/patch-trip-stops.dto';
import type { SearchHotelItem, StopAlternativesResponse, TripApiResponse } from './trip-response';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get('search-hotels')
  searchHotels(
    @Query('query') query: string,
    @Query('area') area?: string,
  ): Promise<SearchHotelItem[]> {
    return this.trips.searchHotels(query, area);
  }

  @Post('generate')
  @UseGuards(RateLimitGuard)
  generate(
    @Body() dto: GenerateTripDto,
    @Headers('x-edit-token') editToken?: string,
  ): Promise<TripApiResponse> {
    return this.trips.generate(dto, editToken);
  }

  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('x-edit-token') editToken?: string,
  ): Promise<TripApiResponse> {
    return this.trips.get(id, editToken);
  }

  @Patch(':id/stops')
  patchStops(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PatchTripStopsDto,
    @Headers('x-edit-token') editToken?: string,
  ): Promise<TripApiResponse> {
    return this.trips.patchStops(id, dto, editToken);
  }

  @Get(':id/stops/:stopId/alternatives')
  getStopAlternatives(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('stopId', new ParseUUIDPipe()) stopId: string,
  ): Promise<StopAlternativesResponse> {
    return this.trips.getStopAlternatives(id, stopId);
  }
}
