import { BadGatewayException, Injectable } from '@nestjs/common';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { TRIP_PREFERENCE_JSON_SCHEMA } from './trip-preference.schema';
import type { ParsedTripPreference } from './preference.types';

@Injectable()
export class TripPreferenceSchemaValidator {
  private readonly validateFunction: ValidateFunction;

  constructor() {
    this.validateFunction = new Ajv({ allErrors: true, strict: true }).compile(
      TRIP_PREFERENCE_JSON_SCHEMA,
    );
  }

  validate(value: unknown): ParsedTripPreference {
    if (!this.validateFunction(value)) {
      throw new BadGatewayException({
        code: 'INVALID_PREFERENCE_OUTPUT',
        message: 'Preference parser output failed JSON Schema validation',
        details: this.formatErrors(this.validateFunction.errors ?? []),
      });
    }

    const pref = value as ParsedTripPreference;
    this.validateSemantics(pref);
    return pref;
  }

  private validateSemantics(pref: ParsedTripPreference): void {
    if (pref.startDate && pref.endDate && pref.startDate > pref.endDate) {
      throw new BadGatewayException({
        code: 'INVALID_DATE_RANGE',
        message: `시작 날짜(${pref.startDate})는 종료 날짜(${pref.endDate})보다 늦을 수 없습니다.`,
      });
    }

    if (pref.days && pref.days.length > 0) {
      if (
        pref.totalDays !== null &&
        pref.totalDays !== undefined &&
        pref.totalDays !== pref.days.length
      ) {
        pref.totalDays = pref.days.length; // 동기화 보정
      }

      for (const day of pref.days) {
        if (day.startTime && day.endTime && day.startTime >= day.endTime) {
          throw new BadGatewayException({
            code: 'INVALID_DAY_TIME_WINDOW',
            message: `Day ${day.dayNumber}의 시작 시각(${day.startTime})은 종료 시각(${day.endTime})보다 앞서야 합니다.`,
          });
        }

        if (day.fixedAppointments) {
          for (const appt of day.fixedAppointments) {
            if (
              appt.targetTime &&
              (appt.targetTime < day.startTime || appt.targetTime > day.endTime)
            ) {
              // 예약 시각이 일과 범위를 벗어날 경우 경고 또는 시간창 조정
              if (appt.targetTime < day.startTime) day.startTime = appt.targetTime;
              if (appt.targetTime > day.endTime) day.endTime = appt.targetTime;
            }
          }
        }
      }
    }
  }

  private formatErrors(errors: ErrorObject[]): Array<{ path: string; message: string }> {
    return errors.map((error) => ({
      path: error.instancePath || '/',
      message: error.message ?? 'invalid value',
    }));
  }
}
