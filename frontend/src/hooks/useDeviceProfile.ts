import { useEffect, useState } from 'react';
import {
  DeviceThermalProfile,
  getThermalProfile,
  subscribeThermalProfile,
  syncThermalDocumentClass,
} from '@/utils/deviceProfile';

export function useDeviceProfile(): DeviceThermalProfile {
  const [profile, setProfile] = useState<DeviceThermalProfile>(() => getThermalProfile());

  useEffect(() => {
    const synced = syncThermalDocumentClass();
    setProfile((prev) =>
      prev.deviceClass === synced.deviceClass &&
      prev.mode === synced.mode &&
      prev.phoneViewMode === synced.phoneViewMode &&
      prev.isThermalGuardActive === synced.isThermalGuardActive &&
      prev.isPhoneMobileUI === synced.isPhoneMobileUI
        ? prev
        : synced
    );
    return subscribeThermalProfile((next) => {
      setProfile(next);
    });
  }, []);

  return profile;
}

